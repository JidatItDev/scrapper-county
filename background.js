chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background script received message:", message);
  return true;
});

let timerId;
let counter = 0;

// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//   if (message.action === "startTimer") {
//     console.log("Timer started in background.");

//     // Clear any existing timer
//     if (timerId) clearInterval(timerId);

//     // Start with counter from storage if it exists
//     chrome.storage.local.get("counter", (data) => {
//       counter = data.counter || 0; // Start from stored counter value or 0

//       // Start the timer
//       timerId = setInterval(() => {
//         counter += 1;
//         console.log(`Timer count: ${counter}`);

//         // Save the updated counter in storage
//         chrome.storage.local.set({ counter });

//         // Optionally, send updates to popup
//         chrome.runtime.sendMessage({ action: "timerUpdate", counter });

//         // Stop the timer after 10 counts
//         if (counter === 10) {
//           clearInterval(timerId);
//           sendResponse({ success: true, message: "Timer completed." });
//         }
//       }, 1000);
//     });

//     sendResponse({ success: true, message: "Timer started." });
//     return true; // Keep the response channel open for async response
//   }

//   if (message.action === "stopTimer") {
//     // Stop the timer
//     if (timerId) {
//       clearInterval(timerId);
//       timerId = null;
//     }
//     sendResponse({ success: true, message: "Timer stopped." });
//   }

//   if (message.action === "getCounter") {
//     // Fetch the counter from chrome.storage
//     chrome.storage.local.get("counter", (data) => {
//       sendResponse({ counter: data.counter || 0 });
//     });
//     return true; // Keep the response channel open for async response
//   }

//   return true; // Keeps the messaging channel open for asynchronous responses
// });

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

    if (result[0].result) {
      console.log("Download initiated successfully");
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
