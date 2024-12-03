document.addEventListener("DOMContentLoaded", () => {
  const extractButton = document.getElementById("extractCaseDetailsBtn");
  const loader = document.getElementById("loader");
  const dataDisplay = document.getElementById("extractedData");

  extractButton.addEventListener("click", () => {
    console.log("Extract button clicked");
    showLoader();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        console.log("Sending message to tab:", tabs[0].id);

        try {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { action: "extractCaseDetails" },
            (response) => {
              console.log("Received response:", response);
              hideLoader();
              dataDisplay.innerHTML = ""; // Clear previous data

              if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                showError(`Error: ${chrome.runtime.lastError.message}`);
                return;
              }

              if (response && response.data) {
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

  function displayCaseDetails(caseDetails) {
    const table = document.createElement("table");
    table.className = "min-w-full divide-y divide-gray-200";
    table.innerHTML = `
        <thead class="bg-gray-50">
          <tr>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Number</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UCN</th>
            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF URL</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          ${caseDetails
            .map(
              (caseDetail) => `
            <tr>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${
                caseDetail.caseNumber
              }</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${
                caseDetail.ucn
              }</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${
                  caseDetail.pdfUrl !== "PDF URL Not Found"
                    ? `<a href="${caseDetail.pdfUrl}" target="_blank" class="text-blue-600 hover:underline">View PDF</a>`
                    : caseDetail.pdfUrl
                }
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      `;

    dataDisplay.appendChild(table);
  }
});
