(function () {
  console.log("Detailed Content Script Loaded");

  // Function to fetch UCN from a single case details page
  async function fetchUCNFromCasePage(href) {
    return new Promise((resolve, reject) => {
      // Create a temporary iframe to load the page
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = href;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        try {
          const ucnElement = iframe.contentDocument.getElementById("caseUCN");

          if (ucnElement) {
            const ucn = ucnElement.textContent.trim();
            resolve(ucn);
          } else {
            resolve(null);
          }
        } catch (error) {
          console.error("Error extracting UCN:", error);
          resolve(null);
        } finally {
          // Remove iframe
          document.body.removeChild(iframe);
        }
      };

      // Handle potential loading errors
      iframe.onerror = () => {
        console.error("Failed to load iframe");
        resolve(null);
        document.body.removeChild(iframe);
      };
    });
  }

  // Main function to extract case details with UCN
  async function extractDetailedCaseInformation() {
    const rows = document.querySelectorAll("table tbody tr");
    console.log(`Found ${rows.length} rows to process`);

    const detailedCases = [];

    for (const row of rows) {
      const caseLinkElement = row.querySelector(".colCaseNumber .caseLink");
      const statusCell = row.querySelector("td:nth-child(5)");

      if (caseLinkElement && statusCell) {
        const statusText = statusCell.textContent.trim();

        // Only process rows where the status is "Closed" or "Reclosed"
        if (statusText === "Closed" || statusText === "Reclosed") {
          const caseNumber = caseLinkElement.textContent.trim();
          const href = caseLinkElement.href;

          try {
            const ucn = await fetchUCNFromCasePage(href);

            detailedCases.push({
              caseNumber: caseNumber,
              href: href,
              ucn: ucn || "UCN Not Found",
            });

            // // Add a delay to prevent overwhelming the server
            // await new Promise((resolve) => setTimeout(resolve, 10));
          } catch (error) {
            console.error(`Error processing case ${caseNumber}:`, error);
          }
        }
      }
    }

    return detailedCases;
  }

  // Message listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received in content script:", request);

    if (request.action === "extractCaseDetails") {
      extractDetailedCaseInformation()
        .then((cases) => {
          console.log("Extracted Detailed Cases:", cases);
          sendResponse({
            type: "caseDetails",
            data: cases,
          });
        })
        .catch((error) => {
          console.error("Error in extractDetailedCaseInformation:", error);
          sendResponse({
            type: "error",
            data: `Error extracting case details: ${error.message}`,
          });
        });

      return true;
    }
  });

  console.log("Content script initialization complete");
})();
