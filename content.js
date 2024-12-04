(() => {
  console.log("Detailed Content Script Loaded");

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

        // Parse the amounts and find the two largest
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
          const context = {
            before: words.slice(Math.max(0, position - 10), position).join(" "),
            after: words.slice(position + 1, position + 10).join(" "),
          };
          return context;
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

  // Function to fetch Details from a single case details page
  async function fetchUCNAndPDFFromCasePage(href) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = href;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        try {
          const iframeDoc =
            iframe.contentDocument || iframe.contentWindow.document;
          const ucnElement = iframeDoc.getElementById("caseUCN");

          const rows = iframeDoc.querySelectorAll("table tbody tr");
          let pdfUrl = null;

          for (const row of rows) {
            const targetCell = Array.from(row.querySelectorAll("td")).find(
              (cell) =>
                Array.from(cell.querySelectorAll("p, a")).some((element) =>
                  element.textContent.trim().includes("Final Judgment")
                )
            );

            if (targetCell) {
              const documentLink = targetCell.querySelector(
                'a[href*="/DocView/Doc"]'
              );

              if (documentLink) {
                pdfUrl = documentLink.href;
                break;
              }
            }
          }

          const ucn = ucnElement ? ucnElement.textContent.trim() : null;
          resolve({
            ucn: ucn || "UCN Not Found",
            pdfUrl: pdfUrl || "PDF URL Not Found",
          });
        } catch (error) {
          console.error("Error extracting UCN and PDF URL:", error);
          resolve({
            ucn: "UCN Not Found",
            pdfUrl: "PDF URL Not Found",
          });
        } finally {
          document.body.removeChild(iframe);
        }
      };

      iframe.onerror = () => {
        console.error("Failed to load iframe");
        resolve({
          ucn: "UCN Not Found",
          pdfUrl: "PDF URL Not Found",
        });
        document.body.removeChild(iframe);
      };
    });
  }

  // Main function to extract case details
  async function extractDetailedCaseInformation() {
    const rows = document.querySelectorAll("table tbody tr");
    console.log(`Found ${rows.length} rows to process`);

    const detailedCases = [];

    for (const row of rows) {
      const caseLinkElement = row.querySelector(".colCaseNumber .caseLink");
      const statusCell = row.querySelector("td:nth-child(5)");

      if (caseLinkElement && statusCell) {
        const statusText = statusCell.textContent.trim();

        if (["Closed", "Reclosed"].includes(statusText)) {
          const caseNumber = caseLinkElement.textContent.trim();
          const href = caseLinkElement.href;

          try {
            const { ucn, pdfUrl } = await fetchUCNAndPDFFromCasePage(href);

            let pdfExtraction = {
              fullText: "No PDF Text Found",
              parsedDetails: null,
            };
            if (pdfUrl !== "PDF URL Not Found") {
              pdfExtraction = await extractPDFText(pdfUrl);
            }

            detailedCases.push({
              caseNumber,
              href,
              pdfUrl,
              ...pdfExtraction,
            });
          } catch (error) {
            console.error(`Error processing case ${caseNumber}:`, error);
          }
        }
      }
    }

    return detailedCases;
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
