chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background script received message:", message);
  return true;
});
const backendUrl = "http://localhost:3000/api/store-pdf"; // This could be stored securely

let timerId;
let counter = 0;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadPdf") {
    handlePdfDownload(request);
    sendResponse({ status: "processing" });
  }
  return true;
});
// In your background.js
async function handlePdfDownload({ url, caseNumber, judgmentName }) {
  // Create a new tab for the PDF
  const tab = await chrome.tabs.create({
    url: url,
    active: false,
  });

  // Wait for tab to load
  await new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  // Execute script to click the specific download button
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (caseNumber, judgmentName) => {
        console.log("case number ", caseNumber, judgmentName);
        // Find the download button by its specific classes
        const downloadBtn = document.querySelector(
          ".git-docviewer-download.git-docviewer-sec-download.git-docviewer-mob-download"
        );

        if (downloadBtn) {
          // Create a custom filename
          const safeName = judgmentName;

          const filename = `${caseNumber}_${safeName}.pdf`;
          console.log("file name", filename);

          // If needed, modify the button's behavior (this depends on how the site works)
          downloadBtn.setAttribute("download", filename);

          // Simulate a click
          downloadBtn.click();
          return true;
        }
        return false;
      },
      args: [caseNumber, judgmentName],
    });
    console.log("download complete , bob conversion case", caseNumber);

    if (result[0].result) {
      console.log("Download initiated successfully");

      // Listen for the download completion and capture the file as a Blob
      chrome.downloads.onChanged.addListener(function (downloadDelta) {
        if (downloadDelta.state && downloadDelta.state.current === "complete") {
          const downloadId = downloadDelta.id;
          chrome.downloads.search(
            { id: downloadId },
            async function (downloads) {
              const download = downloads[0];
              const fileUrl = download.url; // This is the URL of the downloaded PDF
              const response = await fetch(fileUrl);
              const blob = await response.blob(); // Convert the downloaded file to a Blob
              // Now send this Blob along with case details to the backend
              const caseData = {
                caseNumber,
                judgmentName,
                // Include other case details like plaintiffs, defendants, etc.
              };

              await uploadTiffToBackend(caseNumber, blob);
            }
          );
        }
      });
    } else {
      console.warn("Download button not found");
    }
  } catch (error) {
    console.error("Error executing download script:", error);
  }

  // Close the tab after 3 seconds
  setTimeout(() => {
    chrome.tabs.remove(tab.id).catch(() => {});
  }, 3000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractCaseDetails") {
    // Send message to content script to extract case details
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "extractCaseDetails" },
        (response) => {
          if (response?.type === "caseDetails") {
            // Notify popup that data has been scraped
            chrome.runtime.sendMessage({
              action: "caseDetailsExtracted",
              data: response.data,
            });
          } else {
            chrome.runtime.sendMessage({
              action: "error",
              message: response?.data || "No data extracted",
            });
          }
          sendResponse(response); // Optional: send response to the original sender (popup)
        }
      );
    });
  }
  return true; // To indicate async response
});

async function uploadTiffToBackend(caseNumber, tiffBlob, fileName = null) {
  console.log("Uploading TIFF file to backend");
  const formData = new FormData();

  // Append case number
  formData.append("caseNumber", caseNumber);

  // Append the TIFF Blob as a file
  const filename = fileName || `${caseNumber}.tiff`;
  formData.append("pdfFile", tiffBlob, filename);

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      body: formData,
      // Headers are automatically set by FormData for multipart/form-data
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("TIFF uploaded successfully:", data);
    return data;
  } catch (error) {
    console.error("Error uploading TIFF file:", error);
    throw error; // Re-throw to allow caller to handle
  }
}
