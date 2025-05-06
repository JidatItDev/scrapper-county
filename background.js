chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background script received message:", message);
  return true;
});
const backendUrl = "http://localhost:3000/api/store-pdf"; // This could be stored securely
const BASE_URL = "http://localhost:3000";
let timerId;
let counter = 0;

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "handleDocumentDownload") {
    handleDocumentDownload(request);
    sendResponse({ status: "processing" });
  }
  return true;
});

async function handleDocumentDownload({ url, caseNumber, judgmentName }) {
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    // Wait for tab to fully load with longer timeout
    await waitForTabLoad(tab.id);

    // Add additional delay for viewer initialization
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const fileType = await detectFileType(tab.id);
    console.log(`Detected file type: ${fileType}`);

    if (fileType === "pdf") {
      await handlePdfDownload(tab.id, caseNumber, judgmentName, url);
    } else if (fileType === "tiff") {
      await handleTiffDownload(tab.id, caseNumber, judgmentName);
    } else {
      console.warn("Unknown file type, trying both methods");
      try {
        await handlePdfDownload(tab.id, caseNumber, judgmentName, url);
      } catch (e) {
        console.log("PDF download failed, trying TIFF");
        await handleTiffDownload(tab.id, caseNumber, judgmentName);
      }
    }
  } catch (error) {
    console.error("Error handling document download:", error);
  } finally {
    setTimeout(() => chrome.tabs.remove(tab.id), 5000);
  }
}

// Improved tab load waiting with timeout
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Tab load timeout"));
    }, timeout);

    chrome.tabs.onUpdated.addListener(function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function detectFileType(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check for TIFF elements
        const tiffElements = [
          ".git-docviewer-container",
          ".git-docviewer-download",
          'img[src*="tiff"], img[src*="tif"]',
        ].some((sel) => document.querySelector(sel));

        // If any TIFF-related elements are found, return 'tiff'
        if (tiffElements) {
          return "tiff";
        }

        // If it's not TIFF, assume it's PDF
        return "pdf";
      },
    });

    return result[0].result;
  } catch (error) {
    console.error("Detection error:", error);
    return "unknown";
  }
}

async function handlePdfDownload(tabId, caseNumber, judgmentName, url) {
  console.log("tab is ", tabId, caseNumber);
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (url, caseNumber, judgmentName) => {
        // Directly trigger the PDF download by creating an anchor element
        function triggerDownload() {
          // Create an anchor element to trigger the download
          const downloadLink = document.createElement("a");
          downloadLink.href = url; // Use the provided URL for the PDF
          downloadLink.download = `${caseNumber}_${judgmentName.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          )}.pdf`; // Set a custom filename
          downloadLink.click(); // Trigger the download
        }

        // Trigger the download
        triggerDownload();
        return true;
      },
      args: [url, caseNumber, judgmentName],
    });

    if (result[0].result) {
      console.log("PDF download initiated successfully");
      // Optionally, monitor the download after it has been triggered (if needed)
      await monitorDownload(caseNumber, judgmentName, "pdf");
    } else {
      throw new Error("PDF download failed");
    }
  } catch (error) {
    console.error("PDF download failed:", error);
    throw error;
  }
}

// Modified TIFF download handler to use existing tab
async function handleTiffDownload(tabId, caseNumber, judgmentName, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (caseNumber, judgmentName) => {
        const downloadBtn = document.querySelector(
          ".git-docviewer-download.git-docviewer-sec-download.git-docviewer-mob-download"
        );

        if (downloadBtn) {
          const filename = `${caseNumber}_${judgmentName.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          )}.tiff`;
          downloadBtn.setAttribute("download", filename);
          downloadBtn.click();
          return true;
        }
        return false;
      },
      args: [caseNumber, judgmentName],
    });

    if (result[0].result) {
      console.log("TIFF download initiated");
      await monitorDownload(caseNumber, judgmentName, "tiff");
    } else {
      throw new Error("TIFF download button not found");
    }
  } catch (error) {
    console.error("TIFF download failed:", error);
    throw error;
  }
}

// Unified download monitor
function monitorDownload(caseNumber, judgmentName, fileType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error("Download timeout"));
    }, 30000);

    function listener(downloadDelta) {
      if (downloadDelta.state && downloadDelta.state.current === "complete") {
        clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(listener);

        chrome.downloads.search({ id: downloadDelta.id }, async (downloads) => {
          try {
            const download = downloads[0];
            const response = await fetch(download.url);
            const blob = await response.blob();
            await uploadToBackend(caseNumber, blob, fileType, judgmentName);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }
    }

    chrome.downloads.onChanged.addListener(listener);
  });
}

async function uploadToBackend(
  caseNumber,
  fileBlob,
  fileType,
  judgmentName,
  fileName = null
) {
  console.log(`Uploading ${fileType.toUpperCase()} file to backend`);
  const formData = new FormData();

  // Append case details
  formData.append("caseNumber", caseNumber);
  formData.append("fileType", fileType);
  formData.append("judgmentName", judgmentName);

  // Create appropriate filename
  const safeName = judgmentName.replace(/[^a-zA-Z0-9]/g, "_");
  const extension = fileType === "pdf" ? "pdf" : "tiff";
  const filename = fileName || `${caseNumber}_${safeName}.${extension}`;

  // Append the file Blob
  formData.append("pdfFile", fileBlob, filename);

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`${fileType.toUpperCase()} uploaded successfully:`, data);
    return data;
  } catch (error) {
    console.error(`Error uploading ${fileType.toUpperCase()} file:`, error);
    throw error;
  }
}

//update further case Details
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "storeDetailedCaseInfo") {
    storeDetailedCaseInfo(request.payload)
      .then(() => sendResponse({ status: "ok" }))
      .catch((err) => sendResponse({ status: "error", message: err.message }));
    return true; // keep channel open
  }
});

async function storeDetailedCaseInfo(detail) {
  const url = `${BASE_URL}/api/store-detailed-case-info`;
  const body = {
    caseNumber: detail.caseNumber,
    plaintiffs: detail.plaintiffs,
    defendants: detail.defendants,
    judgmentDetails: detail.judgmentDetails,
    caseType: detail.caseType,
    dateFiled: detail.dateFiled,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`store-detailed-case-info failed: ${resp.status} ${text}`);
  }

  console.log(`Stored detailed info for case ${detail.caseNumber}`);
}
