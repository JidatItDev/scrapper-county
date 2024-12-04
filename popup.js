document.addEventListener("DOMContentLoaded", () => {
  const extractButton = document.getElementById("extractCaseDetailsBtn");
  const loader = document.getElementById("loader");
  const dataDisplay = document.getElementById("extractedData");

  //listeners
  //Listener for Download Button
  document.getElementById("downloadCsvBtn").addEventListener("click", () => {
    if (window.caseDetails && window.caseDetails.length > 0) {
      generateImprovedCSV(window.caseDetails);
      generateTextReport(window.caseDetails);
    } else {
      alert("No data to download.");
    }
  });
  //Listener for Extract Details Button
  extractButton.addEventListener("click", () => {
    showLoader();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        try {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { action: "extractCaseDetails" },
            (response) => {
              hideLoader();
              dataDisplay.innerHTML = ""; // Clear previous data

              if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                showError(`Error: ${chrome.runtime.lastError.message}`);
                return;
              }

              if (response?.data) {
                if (response.type === "caseDetails") {
                  displayCaseDetails(response.data);
                } else {
                  showError(response.data);
                }
              } else {
                showError("No data extracted");
              }
            }
          );
        } catch (error) {
          console.error("Error sending message:", error);
          hideLoader();
          showError("Error sending message to the content script");
        }
      } else {
        console.error("No active tab found");
        hideLoader();
        showError("No active tab found");
      }
    });
  });

  //loader UI
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
      "Case Number",
      "PDF URL",
      "Filing Date",
      "Amount",
      "Context Before and After",
      "Full Header",
    ];

    const rows = data.map((caseDetail) => {
      const parsedDetails = caseDetail.parsedDetails;

      // Base details
      const baseDetails = [
        caseDetail.caseNumber,
        caseDetail.pdfUrl !== "PDF URL Not Found" ? caseDetail.pdfUrl : "N/A",
        parsedDetails?.filingDate || "N/A",
      ];

      // Handling monetary values
      const monetaryRows = parsedDetails?.monetaryValues
        ? parsedDetails.monetaryValues
            .map(
              (value) =>
                `${value.amount} (Before: ${value.context.before}, After: ${value.context.after})`
            )
            .join(", ")
        : "N/A";

      // Full Header
      const fullHeader = parsedDetails?.fullHeader || "N/A";

      // Return the row with combined monetary information
      return [
        ...baseDetails,
        monetaryRows, // Combined context information
        fullHeader,
      ];
    });

    // Create CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map(
            (item) => `"${item.replace(/"/g, '""')}"` // Escape double quotes
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
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Number</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF URL</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filing Date</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monetary Values</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Full Header</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${caseDetails
          .map((caseDetail) => {
            const monetaryValues = caseDetail.parsedDetails?.monetaryValues
              ? caseDetail.parsedDetails.monetaryValues
                  .map(
                    (value) => `
                <div>
                  <strong>Amount:</strong> ${value.amount}
                  <div><strong>Before:</strong> ${value.context.before}</div>
                  <div><strong>After:</strong> ${value.context.after}</div>
                </div>`
                  )
                  .join("")
              : "No Monetary Values Found";

            return `
                <tr>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${caseDetail.caseNumber}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${
                      caseDetail.pdfUrl !== "PDF URL Not Found"
                        ? `<a href="${caseDetail.pdfUrl}" target="_blank" class="text-blue-600 hover:underline">View PDF</a>`
                        : "N/A"
                    }
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${caseDetail.parsedDetails?.filingDate || "N/A"}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${monetaryValues}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${caseDetail.parsedDetails?.fullHeader || "N/A"}
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
