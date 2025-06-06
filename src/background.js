let isProduction = false;

let queryIdValue = null; // need to assure that it parses even from main request even from background
let pagUrl = ''

chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (
      details.url.includes('linkedin.com/voyager/api/graphql') &&
      details.url.includes('jobApplicationUrns') &&
      !queryIdValue
    ) {
      const url = new URL(details.url);
      const queryId = url.searchParams.get('queryId');

      if (queryId && queryId.startsWith('voyagerHiringDashJobApplications')) {
        queryIdValue = queryId.split('.')[1];
      }
    }
    if (details.url.startsWith('https://www.linkedin.com/voyager/api/graphql?variables=(start')) {
      const url = new URL(details.url);
      console.log('details.url: ', url);
      pagUrl = details.url;

    }
  },
  { urls: ['*://www.linkedin.com/*'] },
  []
);

(async () => {
  const info = await chrome.management.getSelf();
  isProduction = info.installType !== 'development';

  chrome.runtime.onMessage.addListener((obj, sender, response) => {
    if (obj.type === 'QUERY_ID_REQUEST') {
      response(queryIdValue);
    }

    if (obj.type === 'DEBUG_DATA_APPLICANT') {
      (async () => {
        storeDebugData(obj.data);
      })();
    }
    if (obj.type === 'QUERY_PAG_URL') {
      (async () => {
        response(pagUrl);
      })();
    }
  });
})();

// messaging
async function sendTabMessage(tabId, type, data) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          'Error sending message:',
          chrome.runtime.lastError.message
        );
        resolve(false);
      } else {
        resolve(response);
      }
    });
  });
}

// utils ---------------

async function delay(msec) {
  return new Promise((resolve) => {
    setTimeout(resolve, msec);
  });
}

chrome.webNavigation.onCompleted.addListener(
  function (details) {
    if (
      details.url.includes('/hiring/jobs/') &&
      details.url.includes('/applicants')
    ) {
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['src/content-scripts/ln-content.js'],
      });
    }
  },
  { url: [{ hostSuffix: 'linkedin.com' }] }
);

// debug -----------------------
async function storeDebugData(data) {
  let url = '';

  if (isProduction) {
    url = 'https://introview.com/api/extension/debug';
  } else {
    url = 'http://localhost:8081/api/extension/debug';
  }


  try {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'token': `Bearer ${accessToken}`,
    });

    await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
    });
  } catch (error) {
    console.log('storeDebugData error: ', error);
  }
}