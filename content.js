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

  function generateImprovedCSV(data) {
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
    link.download = "case_details.csv";
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
          console.time("UCN Extraction");
          const ucnElement = iframeDoc.getElementById("caseUCN");
          const ucn = ucnElement
            ? ucnElement.textContent.trim()
            : "UCN Not Found";
          console.timeEnd("UCN Extraction");

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
                      ucn: ucn,
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
            ucn,
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
            ucn: "UCN Not Found",
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
    const existingCaseDiv = document.querySelector("#detailedCaseDiv");
    if (existingCaseDiv) {
      existingCaseDiv.remove();
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
        console.log("status text", statusText);
        if (statusText.includes("closed")) {
          const caseNumber = caseLinkElement.textContent.trim();
          const href = caseLinkElement.href;

          try {
            const {
              ucn,
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
    // Check if there are any detailed cases
    if (detailedCases.length > 0) {
      // Create the main div for the case details
      const caseDiv = document.createElement("div");
      caseDiv.id = "detailedCaseDiv";
      caseDiv.style.position = "fixed";
      caseDiv.style.bottom = "10px";
      caseDiv.style.right = "10px";
      caseDiv.style.padding = "15px";
      caseDiv.style.backgroundColor = "#f3f4f6";
      caseDiv.style.color = "white";
      caseDiv.style.borderRadius = "5px";
      caseDiv.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
      caseDiv.style.zIndex = 10000;

      // Create a heading for the case details
      const heading = document.createElement("h3");
      heading.textContent = `${detailedCases.length} Detailed Case(s) Found`;
      heading.style.margin = "0";
      heading.style.fontSize = "16px";
      heading.style.fontWeight = "bold";
      heading.style.color = "#1f2937"; // Dark gray text for contrast
      caseDiv.appendChild(heading);

      // Create the "Download CSV" button
      const downloadCsvButton = document.createElement("button");
      downloadCsvButton.textContent = "Download CSV";
      downloadCsvButton.style.marginTop = "10px";
      downloadCsvButton.style.padding = "10px";
      downloadCsvButton.style.backgroundColor = "#10b981"; // Green color
      downloadCsvButton.style.color = "white";
      downloadCsvButton.style.fontSize = "14px";
      downloadCsvButton.style.border = "none";
      downloadCsvButton.style.borderRadius = "5px";
      downloadCsvButton.style.cursor = "pointer";
      downloadCsvButton.style.transition = "background-color 0.3s";

      // Add hover effect to button
      downloadCsvButton.onmouseover = () => {
        downloadCsvButton.style.backgroundColor = "#059669";
      };
      downloadCsvButton.onmouseout = () => {
        downloadCsvButton.style.backgroundColor = "#10b981";
      };

      // Add click event to trigger CSV download
      downloadCsvButton.onclick = () => {
        generateImprovedCSV(detailedCases);
      };

      // Append the "Download CSV" button to the caseDiv
      caseDiv.appendChild(downloadCsvButton);

      // Create the accordion container
      const accordionContainer = document.createElement("div");
      accordionContainer.style.marginTop = "10px";

      // Create the accordion button (header)
      const accordionButton = document.createElement("button");
      accordionButton.textContent = "View Case Details";
      accordionButton.style.width = "100%";
      accordionButton.style.padding = "10px";
      accordionButton.style.backgroundColor = "#3b82f6";
      accordionButton.style.color = "white";
      accordionButton.style.textAlign = "left";
      accordionButton.style.fontSize = "14px";
      accordionButton.style.border = "none";
      accordionButton.style.borderRadius = "5px";
      accordionButton.style.cursor = "pointer";
      accordionButton.style.transition = "background-color 0.3s";

      // Add hover effect to button
      accordionButton.onmouseover = () => {
        accordionButton.style.backgroundColor = "#2563eb";
      };
      accordionButton.onmouseout = () => {
        accordionButton.style.backgroundColor = "#3b82f6";
      };

      // Append the button to the accordion container
      accordionContainer.appendChild(accordionButton);

      // Create the accordion content (table for case details)
      const accordionContent = document.createElement("div");
      accordionContent.style.display = "none"; // Initially hidden
      accordionContent.style.padding = "10px";
      accordionContent.style.backgroundColor = "#f9fafb";
      accordionContent.style.borderRadius = "5px";
      accordionContent.style.height = "60vh"; // Takes up 60% height when open
      accordionContent.style.overflowY = "auto"; // Adds scroll if content overflows

      // Create a close button for the accordion
      const closeAccordionButton = document.createElement("button");
      closeAccordionButton.textContent = "Close Details";
      closeAccordionButton.style.padding = "8px 12px";
      closeAccordionButton.style.backgroundColor = "#e11d48"; // Red color for close button
      closeAccordionButton.style.color = "white";
      closeAccordionButton.style.border = "none";
      closeAccordionButton.style.borderRadius = "5px";
      closeAccordionButton.style.marginBottom = "10px";
      closeAccordionButton.style.fontSize = "14px";
      closeAccordionButton.style.cursor = "pointer";

      closeAccordionButton.onclick = () => {
        accordionContent.style.display = "none"; // Hide the content
      };

      // Append close button to the accordion content
      accordionContent.appendChild(closeAccordionButton);

      // Create the table to display the case details
      const table = document.createElement("table");
      table.style.width = "100%";
      table.style.borderCollapse = "collapse";

      // Create table header
      const thead = document.createElement("thead");
      thead.style.backgroundColor = "#f9fafb"; // Light gray background
      thead.style.color = "#374151"; // Dark gray text

      const headerRow = document.createElement("tr");
      const columns = [
        "Case Type",
        "Case Number",
        "Date Filed",
        "Latest Judgment Date",
        "Plaintiffs",
        "Defendants",
        "Judgment Details",
        // New column for the latest judgment date
      ];

      // biome-ignore lint/complexity/noForEach: <explanation>
      columns.forEach((col) => {
        const th = document.createElement("th");
        th.style.padding = "10px";
        th.style.textAlign = "left";
        th.style.fontWeight = "bold";
        th.style.textTransform = "uppercase";
        th.style.fontSize = "12px";
        th.style.borderBottom = "1px solid #e5e7eb"; // Light gray border
        th.textContent = col;
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Create table body
      const tbody = document.createElement("tbody");
      tbody.style.backgroundColor = "#ffffff"; // White background

      // biome-ignore lint/complexity/noForEach: <explanation>
      detailedCases.forEach((caseDetail) => {
        const row = document.createElement("tr");
        row.style.borderBottom = "1px solid #e5e7eb"; // Light gray border

        // Handle each column
        const caseColumns = [
          caseDetail.caseType || "N/A",
          caseDetail.caseNumber || "N/A",
          caseDetail.dateFiled || "N/A",
          (() => {
            const judgmentDates = caseDetail.judgmentDetails
              ? caseDetail.judgmentDetails
                  .map((judgment) => new Date(judgment.date))
                  .sort((a, b) => b - a)
              : [];
            const latestJudgmentDate = judgmentDates.length
              ? judgmentDates[0].toLocaleDateString() // Display the latest date
              : "No Judgment Details";
            return latestJudgmentDate;
          })(),
          caseDetail.plaintiffs
            ? caseDetail.plaintiffs
                .map(
                  (plaintiff) =>
                    `<div><strong>Name:</strong> ${
                      plaintiff.name || "N/A"
                    }</div>`
                )
                .join("")
            : "No Plaintiffs Found",
          caseDetail.defendants
            ? caseDetail.defendants
                .map(
                  (defendant) =>
                    `<div><strong>Name:</strong> ${
                      defendant.name || "N/A"
                    }</div>`
                )
                .join("")
            : "No Defendants Found",
          caseDetail.judgmentDetails
            ? caseDetail.judgmentDetails
                .map(
                  (judgment) =>
                    `<div><strong>${judgment.name}</strong> on ${new Date(
                      judgment.date
                    ).toLocaleDateString()}</div>`
                )
                .join("")
            : "No Judgment Details",
          // Latest Judgment Date logic
        ];

        // biome-ignore lint/complexity/noForEach: <explanation>
        caseColumns.forEach((columnContent) => {
          const td = document.createElement("td");
          td.style.padding = "10px";
          td.style.fontSize = "12px";
          td.style.color = "#1f2937"; // Dark gray text
          td.innerHTML = columnContent;
          row.appendChild(td);
        });

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      accordionContent.appendChild(table);

      // Append the accordion content to the container
      accordionContainer.appendChild(accordionContent);

      // Toggle the accordion content when the button is clicked
      accordionButton.onclick = () => {
        const isVisible = accordionContent.style.display === "block";
        accordionContent.style.display = isVisible ? "none" : "block";
      };

      // Append the accordion container to the caseDiv
      caseDiv.appendChild(accordionContainer);

      // Append the caseDiv to the body of the document
      document.body.appendChild(caseDiv);
    }
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
