let isProduction = false;

let isAuthorized = false;
let accessToken = null;

let queryIdValue = null; // need to assure that it parses even from main request even from background
let pagUrl = ''

// getIsAuthorized();

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
    if (obj.type === 'AUTH_REQUEST_POPUP') {
      (async () => {
        await handlePopupAuthRequest(obj, sender, response);
      })();
      return true;
    }

    if (obj.type === 'QUERY_ID_REQUEST') {
      response(queryIdValue);
    }

    if (obj.type === 'LN_REDIRECT_ACTION') {
      (async () => {
        loginAction();
      })();
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

// auth -----------------------------

async function handlePopupAuthRequest(request, sender, response) {
  if (isAuthorized) {
    response(isAuthorized);
  } else {
    response(false);
  }
}

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

function loginAction() {
  chrome.tabs.create(
    {
      url: isProduction
        ? 'https://introview.com/register?utm_source=extension'
        : 'http://localhost:4000',
    },
    function (tab) {
      chrome.tabs.onUpdated.addListener(function listener(
        tabId,
        changeInfo,
        tab
      ) {
        if (
          tabId === tab.id &&
          changeInfo.status === 'complete' &&
          tab.url.includes(
            isProduction ? 'https://introview.com' : 'http://localhost:4000'
          )
        ) {
          chrome.cookies.get(
            {
              url: isProduction
                ? 'https://introview.com'
                : 'http://localhost:4000',
              name: 'accessToken',
            },
            function (cookie) {
              if (cookie) {
                isAuthorized = true;
                storeAuth(cookie.value, cookie.expirationDate);
                chrome.tabs.query(
                  { url: '*://*.linkedin.com/*' },
                  function (tabs) {
                    if (tabs.length > 0) {
                      chrome.tabs.update(tabs[0].id, { active: true });
                    } else {
                      chrome.tabs.create({
                        url: 'https://www.linkedin.com/my-items/posted-jobs/',
                      });
                    }
                  }
                );
                chrome.tabs.onUpdated.removeListener(listener);
              }
            }
          );
        }
      });
    }
  );
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

function storeAuth(token, expirationTime) {
  chrome.storage.local.set(
    {
      accessToken: token,
      authExpirationTime: expirationTime,
    },
    function () {
      console.log('isAuthorized has been set to true');
    }
  );
  accessToken = token;
}

function getIsAuthorized(callback) {
  chrome.storage.local.get(
    ['accessToken', 'authExpirationTime'],
    function (result) {
      if (chrome.runtime.lastError) {
        console.error('Error getting isAuthorized:', chrome.runtime.lastError);
        if (callback) callback(false);
        return;
      }

      const currentTime = Date.now();

      if (
        result.authExpirationTime &&
        currentTime > result.authExpirationTime
      ) {
        chrome.storage.local.remove(
          ['accessToken', 'authExpirationTime'],
          function () {
            if (chrome.runtime.lastError) {
              console.error(
                'Error removing expired isAuthorized:',
                chrome.runtime.lastError
              );
            } else {
              console.log('isAuthorized has expired and been removed.');
            }
            if (callback) callback(false);
          }
        );
      } else {
        isAuthorized = result.isAuthorized;
        accessToken = result.accessToken;

        if (callback) callback(result.isAuthorized);
      }
    }
  );
}

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

//============
//============
//async function getAuthorized(tabId) {
//  return new Promise((resolve, reject) => {
//    chrome.tabs.sendMessage(tabId, { type: 'CHECK_AUTH' }, (response) => {
//      if (chrome.runtime.lastError) {
//        console.error(
//          'Error sending message:',
//          chrome.runtime.lastError.message
//        );
//        resolve(false);
//      } else {
//        isAuthorized = response;
//        resolve(isAuthorized);
//      }
//    });
//  });
//}
