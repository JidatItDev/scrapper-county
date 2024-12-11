document.addEventListener("DOMContentLoaded", () => {
  const extractButton = document.getElementById("extractCaseDetailsBtn");
  const loader = document.getElementById("loader");
  const dataDisplay = document.getElementById("extractedData");
  let cachedDetails = null;

  chrome.storage.local.get("scrapedData", (result) => {
    if (result.scrapedData) {
      // If there is stored data, display it
      displayCaseDetails(result.scrapedData);
    } else {
      dataDisplay.innerHTML = "No data available. Click 'Extract' to get data.";
    }
  });

  //listeners
  //Listener for Download Button
  document.getElementById("downloadCsvBtn").addEventListener("click", () => {
    if (window.caseDetails && window.caseDetails.length > 0) {
      generateImprovedCSV(window.caseDetails);
      // generateTextReport(window.caseDetails);
    } else {
      alert("No data to download.");
    }
  });

  // // //Listener for Extract Details Button
  // // extractButton.addEventListener("click", () => {
  // //   showLoader();
  // //   cachedDetails = null;

  // //   chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  // //     if (tabs[0]) {
  // //       try {
  // //         chrome.tabs.sendMessage(
  // //           tabs[0].id,
  // //           { action: "extractCaseDetails" },
  // //           (response) => {
  // //             hideLoader();
  // //             dataDisplay.innerHTML = ""; // Clear previous data

  // //             if (chrome.runtime.lastError) {
  // //               console.error("Runtime error:", chrome.runtime.lastError);
  // //               showError(`Error: ${chrome.runtime.lastError.message}`);
  // //               return;
  // //             }

  // //             if (response?.data) {
  // //               if (response.type === "caseDetails") {
  // //                 cachedDetails = response.data; // Cache the fetched data
  // //                 displayCaseDetails(response.data);
  // //               } else {
  // //                 showError(response.data);
  // //               }
  // //             } else {
  // //               showError("No data extracted");
  // //             }
  // //           }
  // //         );
  // //       } catch (error) {
  // //         console.error("Error sending message:", error);
  // //         hideLoader();
  // //         showError("Error sending message to the content script");
  // //       }
  // //     } else {
  // //       console.error("No active tab found");
  // //       hideLoader();
  // //       showError("No active tab found");
  // //     }
  // //   });
  // // });
  // extractButton.addEventListener("click", () => {
  //   showLoader();
  //   chrome.storage.local.remove("scrapedData", () => {
  //     console.log("scrapedData cleared from chrome.storage.local");
  //   });
  //   chrome.runtime.sendMessage({ action: "extractCaseDetails" }, (response) => {
  //     hideLoader();
  //     dataDisplay.innerHTML = ""; // Clear previous data
  //     // chrome.storage.local.set({ scrapedData: "asa" });

  //     if (chrome.runtime.lastError) {
  //       console.error("Runtime error:", chrome.runtime.lastError);
  //       showError(`Error: ${chrome.runtime.lastError.message}`);
  //       return;
  //     }

  //     if (response?.data) {
  //       if (response.type === "caseDetails") {
  //         // Cache the fetched data
  //         chrome.storage.local.set({ scrapedData: response.data });

  //         // Display the extracted data
  //         displayCaseDetails(response.data);
  //       } else {
  //         showError(response.data);
  //       }
  //     } else {
  //       showError("No data extracted");
  //     }
  //   });
  // });

  //loader UI

  extractButton.addEventListener("click", () => {
    showLoader();
    chrome.storage.local.remove("scrapedData", () => {
      console.log("scrapedData cleared from chrome.storage.local");
    });

    chrome.runtime.sendMessage({ action: "extractCaseDetails" }, (response) => {
      hideLoader();

      if (chrome.runtime.lastError) {
        console.error("Runtime error:", chrome.runtime.lastError);
        showError(`Error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (!response) {
        showError("No data extracted");
      }
    });
  });

  // Listen for the background script's response
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "caseDetailsExtracted") {
      // Cache the fetched data
      chrome.storage.local.set({ scrapedData: message.data });

      // Display the extracted data
      displayCaseDetails(message.data);
    } else if (message.action === "error") {
      showError(message.message);
    }
  });

  function showLoader() {
    loader.classList.remove("hidden");
    extractButton.disabled = true;
    extractButton.classList.add("opacity-50", "cursor-not-allowed");
  }

  function hideLoader() {
    loader.classList.add("hidden");
    extractButton.disabled = false;
    extractButton.classList.remove("opacity-50", "cursor-not-allowed");
  }

  function showError(message) {
    dataDisplay.innerHTML = `
      <div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded" role="alert">
        <p class="font-bold">Error</p>
        <p>${message}</p>
      </div>
    `;
  }

  //Functions for exporting data
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
  function generateTextReport(data) {
    let textContent = "Case Details Report\n\n";

    for (const caseDetail of data) {
      textContent += `Case Number: ${caseDetail.caseNumber}\n`;
      textContent += `PDF URL: ${
        caseDetail.pdfUrl !== "PDF URL Not Found" ? caseDetail.pdfUrl : "N/A"
      }\n`;
      textContent += `Filing Date: ${
        caseDetail.parsedDetails?.filingDate || "N/A"
      }\n`;

      // Handling monetary values
      const monetaryValues = caseDetail.parsedDetails?.monetaryValues
        ? caseDetail.parsedDetails.monetaryValues
            .map(
              (value) =>
                `${value.amount} (Before: ${value.context.before}, After: ${value.context.after})`
            )
            .join(", ")
        : "N/A";

      textContent += `Amount and Context: ${monetaryValues}\n`;
      textContent += `Full Header: ${
        caseDetail.parsedDetails?.fullHeader || "N/A"
      }\n\n`;
    }

    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "case_details.txt";
    link.click();
  }

  //Table Display
  function displayCaseDetails(caseDetails) {
    // Save data for CSV export
    window.caseDetails = caseDetails;

    const table = document.createElement("table");
    table.className = "min-w-full divide-y divide-gray-200";
    table.innerHTML = `
      <thead class="bg-gray-50">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Type</th>
          <!--<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF URL</th>-->
          <!-- <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filing Date</th>-->
          <!--<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount 1</th>-->
          <!--<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount 2</th>-->
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Number</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filing Date</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Judgment Date</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plaintiffs</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Defendants</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Judgment Details</th>
          <!--<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Full Header</th>-->
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${caseDetails
          .map((caseDetail) => {
            const monetaryValues =
              caseDetail.parsedDetails?.monetaryValues || [];

            // Ensure unique plaintiffs
            const uniquePlaintiffs = [
              ...new Map(
                caseDetail.plaintiffs.map((item) => [item.name, item])
              ).values(),
            ];

            const plaintiffs =
              uniquePlaintiffs
                .map(
                  (plaintiff) => ` 
                  <div>
                    <strong>Name:</strong> ${plaintiff.name || "N/A"}
                  </div>`
                )
                .join("") || "No Plaintiffs Found";

            // Ensure unique defendants
            const uniqueDefendants = Array.from(
              new Map(caseDetail.defendants.map((d) => [d.name, d]))
            ).map(([_, defendant]) => defendant);

            const defendants =
              uniqueDefendants
                .map(
                  (defendant) => `
                  <div>
                    <strong>Name:</strong> ${defendant.name || "N/A"}
                  </div>`
                )
                .join("") || "No Defendants Found";

            // Extract latest judgment date
            const judgmentDates = caseDetail.judgmentDetails
              ? caseDetail.judgmentDetails
                  .map((judgment) => new Date(judgment.date))
                  .sort((a, b) => b - a)
              : [];

            const latestJudgmentDate = judgmentDates.length
              ? judgmentDates[0].toLocaleDateString() // Display the latest date
              : "No Judgment Details";

            // Display judgment details
            const judgmentDetails = caseDetail.judgmentDetails
              ? caseDetail.judgmentDetails
                  .map((judgment) => {
                    // Only include judgments with valid name and date
                    if (judgment.name && judgment.date) {
                      return `${judgment.name} on ${judgment.date}`;
                    }
                    return null; // Exclude invalid judgments
                  })
                  .filter(Boolean) // Remove null values
                  .join("<br>")
              : "No Judgment Details";

            return `
              <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                   ${caseDetail.caseType || "N/A"}
              
                </td>
                <!--<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${
                    caseDetail.pdfUrl !== "PDF URL Not Found"
                      ? `<a href="${caseDetail.pdfUrl}" target="_blank" class="text-blue-600 hover:underline">View PDF</a>`
                      : "N/A"
                  }
                </td>-->
                <!-- <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${caseDetail.parsedDetails?.filingDate || "N/A"}
                </td> -->
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${caseDetail.caseNumber || "N/A"}
                </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${caseDetail.dateFiled || "N/A"}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${latestJudgmentDate || "N/A"}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${plaintiffs}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${defendants}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${judgmentDetails || "No judment Details"} 
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    `;

    dataDisplay.appendChild(table);
  }
});
