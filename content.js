(() => {
  console.log("Detailed Content Script Loaded");

  // Function to dynamically load Tesseract.js
  // async function loadTesseractJS() {
  //   const scriptURL = chrome.runtime.getURL("tesseract.min.js");
  //   console.log("Tesseract Script URL:", scriptURL);

  //   return new Promise((resolve, reject) => {
  //     const script = document.createElement("script");
  //     script.src = scriptURL;

  //     script.onload = () => {
  //       if (typeof Tesseract === "undefined") {
  //         console.error("Tesseract.js did not load correctly.");
  //         reject(new Error("Tesseract.js did not load correctly."));
  //       } else {
  //         console.log("Tesseract.js loaded successfully.");
  //         resolve();
  //       }
  //     };

  //     script.onerror = (event) => {
  //       console.error("Failed to load Tesseract.js:", event);
  //       reject(new Error("Failed to load Tesseract.js"));
  //     };

  //     document.head.appendChild(script);
  //   });
  // }

  // Function to perform OCR on a PDF image URL
  async function performOCR(imageUrl) {
    try {
      const { createWorker } = Tesseract;
      const worker = createWorker({
        workerPath: chrome.runtime.getURL("worker.min.js"),
        corePath: chrome.runtime.getURL("tesseract.esm.min.js"),
      });

      console.log("Initializing Tesseract worker...");
      await worker.load();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");

      console.log("Processing OCR...");
      const {
        data: { text },
      } = await worker.recognize(imageUrl);

      console.log("Extracted text from OCR:", text);

      // Terminate the worker after OCR
      await worker.terminate();

      return text;
    } catch (error) {
      console.error("OCR Error:", error);
      return "OCR Failed: " + error.message;
    }
  }

  // Function to fetch UCN and PDF URL from a single case details page
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

  // Main function to extract case details with OCR
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

            let ocrText = "No OCR Text Found";
            if (pdfUrl !== "PDF URL Not Found") {
              ocrText = await performOCR(pdfUrl);
            }

            detailedCases.push({
              caseNumber,
              href,
              ucn,
              pdfUrl,
              ocrText,
            });
          } catch (error) {
            console.error(`Error processing case ${caseNumber}:`, error);
          }
        }
      }
    }

    return detailedCases;
  }

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
