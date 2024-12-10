chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background script received message:", message);
  return true;
});

let timerId;
let counter = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startTimer") {
    console.log("Timer started in background.");

    // Clear any existing timer
    if (timerId) clearInterval(timerId);

    // Start with counter from storage if it exists
    chrome.storage.local.get("counter", (data) => {
      counter = data.counter || 0; // Start from stored counter value or 0

      // Start the timer
      timerId = setInterval(() => {
        counter += 1;
        console.log(`Timer count: ${counter}`);

        // Save the updated counter in storage
        chrome.storage.local.set({ counter });

        // Optionally, send updates to popup
        chrome.runtime.sendMessage({ action: "timerUpdate", counter });

        // Stop the timer after 10 counts
        if (counter === 10) {
          clearInterval(timerId);
          sendResponse({ success: true, message: "Timer completed." });
        }
      }, 1000);
    });

    sendResponse({ success: true, message: "Timer started." });
    return true; // Keep the response channel open for async response
  }

  if (message.action === "stopTimer") {
    // Stop the timer
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    sendResponse({ success: true, message: "Timer stopped." });
  }

  if (message.action === "getCounter") {
    // Fetch the counter from chrome.storage
    chrome.storage.local.get("counter", (data) => {
      sendResponse({ counter: data.counter || 0 });
    });
    return true; // Keep the response channel open for async response
  }

  return true; // Keeps the messaging channel open for asynchronous responses
});
