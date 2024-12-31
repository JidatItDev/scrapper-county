(() => {
  console.log("Detailed Content Script Loaded");

  // Dynamically inject Tailwind CSS via CDN
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://cdn.jsdelivr.net/npm/tailwindcss@3.0.24/dist/tailwind.min.css"; // Tailwind CSS CDN
  document.head.appendChild(link);

  // Dynamically import PDF.js
  async function importPDFJS() {
    try {
      const pdfjsLib = await import(chrome.runtime.getURL("pdf.mjs"));
      return pdfjsLib;
    } catch (error) {
      console.error("Failed to import PDF.js:", error);
      throw error;
    }
  }

  //EXTRACTNG TEXT FROM PDF , WHOLE TEXT
  async function extractPDFText(pdfUrl) {
    try {
      const pdfjsLib = await importPDFJS();

      // Configure worker path
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        chrome.runtime.getURL("pdf.worker.mjs");

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;

      let fullText = "";

      // Iterate through all pages
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text from all text items on the page
        const pageText = textContent.items.map((item) => item.str).join(" ");

        fullText += pageText + "\n";
      }

      // Parse extracted text
      const parsedDetails = parseExtractedText(fullText);

      return {
        fullText,
        parsedDetails,
      };
    } catch (error) {
      console.error("PDF Text Extraction Error:", error);
      return {
        fullText: `PDF Text Extraction Failed: ${error.message}`,
        parsedDetails: null,
      };
    }
  }
  //EXTRACTING SPECIFIC DETAILS FROM THE WHOLE TEXT
  function parseExtractedText(text) {
    // Remove extra whitespaces and normalize text
    const cleanText = text.replace(/\s+/g, " ").trim();

    // Extractors for different pieces of information
    const extractors = {
      fullHeader: () => {
        // Match everything from the start up to the first occurrence of "Defendant" or similar terms
        const headerMatch = cleanText.match(/^(.*?Defendant[\s\S]*?,)/i);
        return headerMatch ? headerMatch[1].trim() : null;
      },
      caseNumber: () => {
        const caseNumberMatch = cleanText.match(/CASE\s*NO[:.]\s*([^\s]+)/i);
        return caseNumberMatch ? caseNumberMatch[1].trim() : null;
      },
      filingDate: () => {
        const dateMatches = cleanText.match(
          /(?:E-?Filed|Filed)\s*(\d{2}\/\d{2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4})\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
        );
        return dateMatches
          ? `${dateMatches[1]} ${dateMatches[2] || ""}`.trim()
          : null;
      },
      monetaryValues: () => {
        // Extract all dollar amounts and their positions
        const moneyMatches = [];
        let match;
        const moneyRegex = /\$[\d,]+(?:\.\d{2})?/g;

        while ((match = moneyRegex.exec(cleanText)) !== null) {
          moneyMatches.push({ value: match[0], index: match.index });
        }

        // If no matches, return null
        if (!moneyMatches.length) return null;

        // Parse the amounts and sort by numeric value
        const parsedAmounts = moneyMatches.map((item) => ({
          ...item,
          numericValue: Number.parseFloat(item.value.replace(/[,$]/g, "")),
        }));
        const sortedAmounts = parsedAmounts.sort(
          (a, b) => b.numericValue - a.numericValue
        );
        const topTwo = sortedAmounts.slice(0, 2);

        // Extract context for each value
        const getContext = (index) => {
          const words = cleanText.split(/\s+/);
          const position = cleanText.slice(0, index).split(/\s+/).length; // Get word position of the match
          return {
            before: words.slice(Math.max(0, position - 10), position).join(" "),
            after: words.slice(position + 1, position + 10).join(" "),
          };
        };

        // Map top two values to include context
        const results = topTwo.map((item) => ({
          amount: item.value,
          numericValue: item.numericValue,
          context: getContext(item.index),
        }));

        return results;
      },
    };

    // Compile parsed details
    return {
      fullHeader: extractors.fullHeader(),
      filingDate: extractors.filingDate(),
      monetaryValues: extractors.monetaryValues(),
    };
  }
  function cleanUpPartyNames(caseTableRows) {
    const plaintiffs = [];
    const defendants = [];
    const uniquePlaintiffs = new Set();
    const uniqueDefendants = new Set();

    // biome-ignore lint/complexity/noForEach: <explanation>
    Array.from(caseTableRows)
      .filter((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        return cells[1]?.textContent.trim() === "Plaintiff";
      })
      .forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const rawName = cells[0]?.textContent.trim() || "N/A";
        const cleanedName = rawName
          .replace(/\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (!uniquePlaintiffs.has(cleanedName)) {
          const plaintiffEntry = {
            name: cleanedName,
            attorney: cells[2]?.textContent.trim() || "N/A",
            attorneyPhone: cells[3]?.textContent.trim() || "N/A",
          };
          uniquePlaintiffs.add(cleanedName);
          plaintiffs.push(plaintiffEntry);
        }
      });

    // biome-ignore lint/complexity/noForEach: <explanation>
    Array.from(caseTableRows)
      .filter((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        return cells[1]?.textContent.trim() === "Defendant";
      })
      .forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const rawName = cells[0]?.textContent.trim() || "N/A";
        const cleanedName = rawName
          .replace(/\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (!uniqueDefendants.has(cleanedName)) {
          const defendantEntry = {
            name: cleanedName,
            attorney: cells[2]?.textContent.trim() || "N/A",
            attorneyPhone: cells[3]?.textContent.trim() || "N/A",
          };
          uniqueDefendants.add(cleanedName);
          defendants.push(defendantEntry);
        }
      });

    return { plaintiffs, defendants };
  }

  function generateImprovedCSV(data, filename) {
    const headers = [
      "Case Type",
      "Case Number",
      "Filing Date",
      "Judgment Date",
      "Plaintiffs",
      "Defendants",
      "Judgment Details",
      // "PDF URL"
    ];

    const rows = data.map((caseDetail) => {
      // Process Plaintiffs
      const plaintiffs = caseDetail.plaintiffs
        .map(
          (p) =>
            `${p.name} (Attorney: ${p.attorney}, Phone: ${p.attorneyPhone})`
        )
        .join(" | ");

      // Process Defendants
      const defendants = caseDetail.defendants
        .map(
          (d) =>
            `${d.name} (Attorney: ${d.attorney}, Phone: ${d.attorneyPhone})`
        )
        .join(" | ");

      // Process Judgment Details
      const judgmentDetails = caseDetail.judgmentDetails
        .map((j) => `${j.name} on ${j.date}`)
        .join(" | ");

      // Return row with new structure
      return [
        caseDetail.caseType || "N/A",
        caseDetail.caseNumber || "N/A",
        caseDetail.dateFiled || "N/A",
        caseDetail.judgmentDetails.length > 0
          ? caseDetail.judgmentDetails[caseDetail.judgmentDetails.length - 1]
              .date
          : "N/A",
        plaintiffs || "N/A",
        defendants || "N/A",
        judgmentDetails || "N/A",
        // caseDetail.pdfUrl || "N/A"
      ];
    });

    // Create CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map(
            (item) => `"${String(item).replace(/"/g, '""')}"` // Ensure string conversion and escape quotes
          )
          .join(",")
      ),
    ].join("\r\n");

    // Create a Blob for downloading the CSV
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  // Function to fetch Details from a single case details page
  async function fetchUCNAndPDFFromCasePage(href) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = href;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        console.time("Total Processing Time");
        try {
          const iframeDoc =
            iframe.contentDocument || iframe.contentWindow.document;

          // Start measuring each section

          console.time("Case Type Extraction");
          const caseTypeElement = Array.from(
            iframeDoc.querySelectorAll(".row .col-md-5.text-right.pull-left")
          ).find((div) => div.textContent.trim() === "Case Type:");
          const caseType = caseTypeElement
            ? caseTypeElement.nextElementSibling?.textContent.trim() ||
              "Case Type Not Found"
            : "Case Type Not Found";
          console.timeEnd("Case Type Extraction");

          console.time("Judgment Details Extraction");
          const docketDataDiv = iframeDoc.querySelector("#docketData");
          let pdfUrl = null;
          const uniqueJudgments = new Map();
          const judgmentDetails = [];

          if (docketDataDiv) {
            const rows = docketDataDiv.querySelectorAll("table tbody tr");

            // biome-ignore lint/complexity/noForEach: <explanation>
            rows.forEach((row) => {
              const textContent = row.textContent.trim().toLowerCase();
              if (!textContent.includes("judgment")) {
                console.log("skipping this row");
                return;
              }
              // Check if "judgment" occurs AFTER "Comments:"
              const commentsIndex = textContent.indexOf("comments:");
              const judgmentIndex = textContent.indexOf("judgment");

              if (commentsIndex !== -1 && judgmentIndex > commentsIndex) {
                console.log(
                  "Skipping this row: 'judgment' is after 'Comments:'."
                );
                return;
              }
              const containsJudgment = textContent.includes("judgment");
              if (containsJudgment) {
                const dateCell = Array.from(row.querySelectorAll("td")).find(
                  (cell) => /\d{2}\/\d{2}\/\d{4}/.test(cell.textContent.trim())
                );
                const judgmentDate = dateCell
                  ? dateCell.textContent.trim()
                  : "Date Not Found";

                const judgmentCell = Array.from(
                  row.querySelectorAll("td")
                ).find((cell) => cell.textContent.trim().includes("Judgment"));
                const judgmentName = judgmentCell
                  ? judgmentCell.textContent.trim()
                  : "Judgment Name Not Found";

                if (judgmentName && judgmentDate) {
                  const uniqueKey = `${judgmentName}-${judgmentDate}`;
                  if (!uniqueJudgments.has(uniqueKey)) {
                    const judgmentEntry = {
                      name: judgmentName,
                      date: judgmentDate,
                    };
                    uniqueJudgments.set(uniqueKey, judgmentEntry);
                    judgmentDetails.push(judgmentEntry);
                  }
                }

                if (judgmentName.includes("Final Judgment")) {
                  const documentLink = row.querySelector(
                    'a[href*="/DocView/Doc"]'
                  );
                  if (documentLink) {
                    pdfUrl = documentLink.href;
                  }
                }
              }
            });
          }
          // Skip rows where no judgments are found
          if (judgmentDetails.length === 0) {
            resolve(null); // Skip this case entirely
            return;
          }
          console.timeEnd("Judgment Details Extraction");

          console.time("Party Names Extraction");
          const caseTableRows = iframeDoc.querySelectorAll("tbody tr");
          const { plaintiffs, defendants } = cleanUpPartyNames(caseTableRows);
          console.timeEnd("Party Names Extraction");

          console.time("Date Filed Extraction");
          const dateFiledElement = Array.from(
            iframeDoc.querySelectorAll(".row .col-md-5.text-right.pull-left")
          ).find((div) => div.textContent.trim() === "Date Filed:");
          const dateFiled = dateFiledElement
            ? dateFiledElement.nextElementSibling?.textContent.trim() || " "
            : " ";
          console.timeEnd("Date Filed Extraction");

          console.timeEnd("Total Processing Time");

          resolve({
            pdfUrl: pdfUrl || "PDF URL Not Found",
            plaintiffs,
            defendants,
            judgmentDetails,
            caseType,
            dateFiled,
          });
        } catch (error) {
          console.error("Error extracting data:", error);
          resolve({
            // ucn: "UCN Not Found",
            pdfUrl: "PDF URL Not Found",
            plaintiffs: [],
            defendants: [],
            judgmentDetails: [],
            dateFiled: "Date Filed Not Found",
          });
        } finally {
          document.body.removeChild(iframe);
        }
      };
    });
  }

  // Main function to extract case details
  async function extractDetailedCaseInformation() {
    const existingParentDiv = document.querySelector("#detailedCaseContainer");
    if (existingParentDiv) {
      existingParentDiv.remove();
    }

    // Create and display the loader
    const loaderDiv = document.createElement("div");
    loaderDiv.style.position = "fixed";
    loaderDiv.style.bottom = "10px"; // Make it match the position of the accordion
    loaderDiv.style.right = "10px"; // Align it similarly to the accordion
    loaderDiv.style.padding = "20px";
    loaderDiv.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    loaderDiv.style.color = "white";
    loaderDiv.style.borderRadius = "5px";
    loaderDiv.style.zIndex = 10001;
    loaderDiv.style.fontSize = "16px";
    loaderDiv.innerHTML = `
      <div class="loader" style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite;"></div>
      <p>Loading detailed case information...</p>
    `;
    document.body.appendChild(loaderDiv);

    // Add keyframes for loader spin animation
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    const rows = document.querySelectorAll("table tbody tr");
    console.log(`Found ${rows.length} rows to process`);

    const detailedCases = [];
    let count = 0;

    for (const row of rows) {
      const caseLinkElement = row.querySelector(".colCaseNumber .caseLink");
      const statusCell = row.querySelector("td:nth-child(5)");
      count += 1;
      console.log(count);

      if (caseLinkElement && statusCell) {
        const statusText = statusCell.textContent.trim().toLowerCase();
        if (statusText.includes("closed")) {
          const caseNumber = caseLinkElement.textContent.trim();
          const href = caseLinkElement.href;

          try {
            const {
              pdfUrl,
              plaintiffs,
              defendants,
              judgmentDetails,
              caseType,
              dateFiled,
            } = await fetchUCNAndPDFFromCasePage(href);
            console.log("judgment details in main", judgmentDetails);

            detailedCases.push({
              caseNumber,
              plaintiffs,
              defendants,
              judgmentDetails,
              caseType,
              dateFiled,
            });
          } catch (error) {
            console.error(`Error processing case ${caseNumber}:`, error);
          }
        }
      }
    }

    // Remove the loader once the data is fetched
    document.body.removeChild(loaderDiv);

    // Display the detailed case information
    displayDetailedCaseDiv(detailedCases);
    return detailedCases;
  }

  function displayDetailedCaseDiv(detailedCases) {
    // if (detailedCases.length === 0) return;

    const companyCases = detailedCases.filter((caseDetail) =>
      caseDetail.plaintiffs.some((plaintiff) =>
        /INC|COMPANY|LLC/i.test(plaintiff.name)
      )
    );

    const individualCases = detailedCases.filter(
      (caseDetail) =>
        !caseDetail.plaintiffs.some((plaintiff) =>
          /INC|COMPANY|LLC/i.test(plaintiff.name)
        )
    );
    const parentContainer = document.createElement("div");
    parentContainer.id = "detailedCaseContainer";
    parentContainer.style.position = "relative";
    parentContainer.style.zIndex = "9998"; // Slightly lower than the panel and FAB
    document.body.appendChild(parentContainer);

    // Create floating action button (FAB)
    const fab = document.createElement("div");
    fab.id = "caseFAB";
    fab.style.position = "fixed";
    fab.style.bottom = "20px";
    fab.style.right = "20px";
    fab.style.backgroundColor = "#3b82f6";
    fab.style.color = "white";
    fab.style.padding = "15px 20px";
    fab.style.borderRadius = "30px";
    fab.style.cursor = "pointer";
    fab.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
    fab.style.transition = "transform 0.3s ease";
    fab.style.zIndex = "9999";
    fab.innerHTML = `<span style="font-weight: bold">${detailedCases.length}</span> Cases Found`;

    fab.onmouseover = () => {
      fab.style.transform = "scale(1.05)";
      fab.style.backgroundColor = "#2563eb";
    };
    fab.onmouseout = () => {
      fab.style.transform = "scale(1)";
      fab.style.backgroundColor = "#3b82f6";
    };

    // Create slide panel
    const panel = document.createElement("div");
    panel.id = "casePanel";
    panel.style.position = "fixed";
    panel.style.top = "0";
    panel.style.right = "-100%"; // Start offscreen
    panel.style.width = "100%";
    panel.style.height = "100vh";
    panel.style.backgroundColor = "white";
    panel.style.boxShadow = "-2px 0 5px rgba(0, 0, 0, 0.1)";
    panel.style.transition = "right 0.3s ease";
    panel.style.zIndex = "10000";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";

    // Panel header
    const header = document.createElement("div");
    header.style.padding = "20px";
    header.style.backgroundColor = "#f8fafc";
    header.style.borderBottom = "1px solid #e2e8f0";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    // Close button
    const closeButton = document.createElement("button");
    closeButton.innerHTML = "×";
    closeButton.style.fontSize = "24px";
    closeButton.style.border = "none";
    closeButton.style.background = "none";
    closeButton.style.cursor = "pointer";
    closeButton.style.padding = "5px 10px";
    closeButton.style.color = "#64748b";

    // Title and buttons container
    const titleContainer = document.createElement("div");
    titleContainer.style.display = "flex";
    titleContainer.style.alignItems = "center";
    titleContainer.style.gap = "15px";

    const title = document.createElement("h2");
    title.textContent = "Case Details";
    title.style.margin = "0";
    title.style.fontSize = "20px";
    title.style.color = "#1e293b";

    const downloadButton = document.createElement("button");
    downloadButton.textContent = "Download CSV";
    downloadButton.style.padding = "8px 16px";
    downloadButton.style.backgroundColor = "#10b981";
    downloadButton.style.color = "white";
    downloadButton.style.border = "none";
    downloadButton.style.borderRadius = "6px";
    downloadButton.style.cursor = "pointer";
    downloadButton.onclick = () => {
      // Download company cases first
      generateImprovedCSV(companyCases, "company_cases.csv");

      // Add a slight delay before downloading the second file
      setTimeout(() => {
        generateImprovedCSV(individualCases, "individual_cases.csv");
      }, 100); // Delay of 100ms
    };

    titleContainer.appendChild(title);
    titleContainer.appendChild(downloadButton);
    header.appendChild(titleContainer);
    header.appendChild(closeButton);

    // Tab container with modern styling
    const tabContainer = document.createElement("div");
    tabContainer.style.padding = "0 20px";
    tabContainer.style.backgroundColor = "white";
    tabContainer.style.borderBottom = "1px solid #e2e8f0";

    const tabs = document.createElement("div");
    tabs.style.display = "flex";
    tabs.style.gap = "20px";

    const createModernTab = (text, count, isActive = false) => {
      const tab = document.createElement("button");
      tab.innerHTML = `${text} <span style="margin-left: 5px; padding: 2px 8px; background-color: ${
        isActive ? "#3b82f6" : "#e2e8f0"
      }; color: ${
        isActive ? "white" : "#64748b"
      }; border-radius: 12px; font-size: 12px;">${count}</span>`;
      tab.style.padding = "16px 0";
      tab.style.border = "none";
      tab.style.background = "none";
      tab.style.cursor = "pointer";
      tab.style.color = isActive ? "#3b82f6" : "#64748b";
      tab.style.borderBottom = isActive
        ? "2px solid #3b82f6"
        : "2px solid transparent";
      tab.style.fontWeight = "500";
      return tab;
    };

    const companyTab = createModernTab(
      "Company Cases",
      companyCases.length,
      true
    );
    const individualTab = createModernTab(
      "Individual Cases",
      individualCases.length
    );

    tabs.appendChild(companyTab);
    tabs.appendChild(individualTab);
    tabContainer.appendChild(tabs);

    // Content container
    const contentContainer = document.createElement("div");
    contentContainer.style.flex = "1";
    contentContainer.style.overflow = "auto";
    contentContainer.style.padding = "20px";

    const companyContent = createTableContainer(companyCases);
    const individualContent = createTableContainer(individualCases);

    companyContent.style.display = "block";
    individualContent.style.display = "none";

    contentContainer.appendChild(companyContent);
    contentContainer.appendChild(individualContent);

    // Tab switching logic with modern styling updates
    companyTab.onclick = () => {
      companyTab.style.color = "#3b82f6";
      companyTab.style.borderBottom = "2px solid #3b82f6";
      companyTab.querySelector("span").style.backgroundColor = "#3b82f6";
      companyTab.querySelector("span").style.color = "white";

      individualTab.style.color = "#64748b";
      individualTab.style.borderBottom = "2px solid transparent";
      individualTab.querySelector("span").style.backgroundColor = "#e2e8f0";
      individualTab.querySelector("span").style.color = "#64748b";

      companyContent.style.display = "block";
      individualContent.style.display = "none";
    };

    individualTab.onclick = () => {
      individualTab.style.color = "#3b82f6";
      individualTab.style.borderBottom = "2px solid #3b82f6";
      individualTab.querySelector("span").style.backgroundColor = "#3b82f6";
      individualTab.querySelector("span").style.color = "white";

      companyTab.style.color = "#64748b";
      companyTab.style.borderBottom = "2px solid transparent";
      companyTab.querySelector("span").style.backgroundColor = "#e2e8f0";
      companyTab.querySelector("span").style.color = "#64748b";

      individualContent.style.display = "block";
      companyContent.style.display = "none";
    };

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(tabContainer);
    panel.appendChild(contentContainer);

    // Assemble all elements into the parent container
    parentContainer.appendChild(fab);
    parentContainer.appendChild(panel);

    // Toggle panel visibility
    fab.onclick = () => {
      panel.style.right = "0";
    };

    closeButton.onclick = () => {
      panel.style.right = "-100%";
    };

    // Add to document
    // document.body.appendChild(fab);
    // document.body.appendChild(panel);

    // Add click outside to close
    document.addEventListener("click", (e) => {
      if (
        !panel.contains(e.target) &&
        !fab.contains(e.target) &&
        panel.style.right === "0px"
      ) {
        panel.style.right = "-100%";
      }
    });
  }

  function createTableContainer(cases) {
    const container = document.createElement("div");
    container.style.marginTop = "15px";
    container.style.maxHeight = "60vh";
    container.style.overflowY = "auto";

    if (cases.length === 0) {
      const emptyMessage = document.createElement("p");
      emptyMessage.textContent = "No cases found";
      emptyMessage.style.textAlign = "center";
      emptyMessage.style.color = "#6b7280";
      container.appendChild(emptyMessage);
      return container;
    }

    const table = createCaseTable(cases);
    container.appendChild(table);
    return container;
  }

  function createCaseTable(cases) {
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";

    const thead = document.createElement("thead");
    thead.style.backgroundColor = "#f9fafb";
    thead.style.position = "sticky";
    thead.style.top = "0";

    const headerRow = document.createElement("tr");
    const columns = [
      "Case Type",
      "Case Number",
      "Date Filed",
      "Latest Judgment Date",
      "Plaintiffs",
      "Defendants",
      "Judgment Details",
    ];

    columns.forEach((col) => {
      const th = document.createElement("th");
      th.style.padding = "10px";
      th.style.textAlign = "left";
      th.style.fontWeight = "bold";
      th.style.fontSize = "12px";
      th.style.color = "#374151";
      th.style.borderBottom = "1px solid #e5e7eb";
      th.textContent = col;
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    cases.forEach((caseDetail) => {
      const row = document.createElement("tr");
      row.style.borderBottom = "1px solid #e5e7eb";

      const columns = [
        caseDetail.caseType || "N/A",
        caseDetail.caseNumber || "N/A",
        caseDetail.dateFiled || "N/A",
        getLatestJudgmentDate(caseDetail),
        formatPlaintiffs(caseDetail.plaintiffs),
        formatDefendants(caseDetail.defendants),
        formatJudgmentDetails(caseDetail.judgmentDetails),
      ];

      columns.forEach((content) => {
        const td = document.createElement("td");
        td.style.padding = "10px";
        td.style.fontSize = "12px";
        td.style.color = "#1f2937";
        td.innerHTML = content;
        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
  }

  function getLatestJudgmentDate(caseDetail) {
    const judgmentDates = caseDetail.judgmentDetails
      ? caseDetail.judgmentDetails
          .map((judgment) => new Date(judgment.date))
          .sort((a, b) => b - a)
      : [];
    return judgmentDates.length
      ? judgmentDates[0].toLocaleDateString()
      : "No Judgment Details";
  }

  function formatPlaintiffs(plaintiffs) {
    return plaintiffs
      ? plaintiffs
          .map(
            (plaintiff) =>
              `<div><strong>Name:</strong> ${plaintiff.name || "N/A"}</div>`
          )
          .join("")
      : "No Plaintiffs Found";
  }

  function formatDefendants(defendants) {
    return defendants
      ? defendants
          .map(
            (defendant) =>
              `<div><strong>Name:</strong> ${defendant.name || "N/A"}</div>`
          )
          .join("")
      : "No Defendants Found";
  }

  function formatJudgmentDetails(judgmentDetails) {
    return judgmentDetails
      ? judgmentDetails
          .map(
            (judgment) =>
              `<div><strong>${judgment.name}</strong> on ${new Date(
                judgment.date
              ).toLocaleDateString()}</div>`
          )
          .join("")
      : "No Judgment Details";
  }
  // Message listener for extracting case details
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received in content script:", request);

    if (request.action === "extractCaseDetails") {
      extractDetailedCaseInformation()
        .then((cases) => sendResponse({ type: "caseDetails", data: cases }))
        .catch((error) =>
          sendResponse({
            type: "error",
            data: `Error extracting case details: ${error.message}`,
          })
        );
      return true; // Indicates asynchronous response
    }
  });

  console.log("Content script initialization complete");
})();
