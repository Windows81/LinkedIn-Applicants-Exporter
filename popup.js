let title = '';

const container = document.getElementsByClassName('container')[0];
const footer = document.querySelector('.footer');

document.addEventListener('DOMContentLoaded', async () => {
  hidrateOpenLnBtn();

  chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
    var activeTab = tabs[0];

    if (!/linkedin\.com\/hiring\/jobs\/.*\/applicants/.test(activeTab.url)) {
      const infoElement = document.getElementById('go-ln');
      infoElement.classList.remove('hidden');
      showOpenLnBtn();
    } else {
      const infoElement = document.getElementById('go-ln');
      infoElement.classList.add('hidden');
    }

    if (/linkedin\.com/.test(activeTab.url) && !/linkedin\.com\/hiring\/jobs\/.*\/applicants/.test(activeTab.url)) {
      showOpenLnBtn();
    }

    if (/linkedin\.com\/hiring\/jobs\/.*\/applicants/.test(activeTab.url)) {
      const lnJob = await withRetry(
        async () => await sendTabMessage(activeTab.id, 'GET_JOB_METADATA_POPUP', { tabId: activeTab.id }, true),
        20,
        150
      );

      if (lnJob) renderLnTabs(lnJob);
    }
  });
});

chrome.runtime.onMessage.addListener((obj, sender, response) => {
  if (obj.type === 'PARSED_APPLICANTS') {
    renderDownload(obj.data);
  }
  if (obj.type === 'PARSED_APPLICANTS_COUNT') {
    renderCount(obj.data);
  }
});

// render
function renderLnTabs({ title: _title, count, tabId }) {
  title = _title;
  const tabBlock = document.createElement('div');
  tabBlock.classList.add('main-block');
  tabBlock.id = 'parse-block';

  const iconBlock = document.createElement('div');
  const icon = document.createElement('img');
  icon.src = 'images/applicants.svg';
  icon.classList.add('main-icon');
  iconBlock.appendChild(icon);
  tabBlock.appendChild(iconBlock);

  const messageBlock = document.createElement('div');
  messageBlock.innerHTML = `
  <div class="main-message">Export <b>${count} applicants</b> from <b>${_title}</b>.</div>`;
  tabBlock.appendChild(messageBlock);

  const btn = createBtn({
    classList: ['main-btn'],
    id: 'appls',
    label: `Export ${count} applicants`,
    onClick: (event) => {
      chrome.tabs.sendMessage(tabId, {
        type: 'PARSE_APPLICANTS',
        data: { tabId },
      });

      iconBlock.classList.add('hidden');
      messageBlock.classList.add('hidden');
      btn.disabled = true;
      const loader = createLoader();

      tabBlock.insertBefore(loader, btn);
    },
  });
  tabBlock.appendChild(btn);
  container.insertBefore(tabBlock, footer);
}

function createLoader() {
  const loaderBlock = document.createElement('div');
  loaderBlock.classList.add('loader-block');

  const loaderWrapper = document.createElement('div');
  loaderWrapper.classList.add('loader-wrapper');

  const outerLoader = document.createElement('div');
  outerLoader.classList.add('loader-outer');

  const counter = document.createElement('div');
  counter.classList.add('counter');

  const loader = document.createElement('div');
  loader.classList.add('loader');

  outerLoader.appendChild(loader);
  outerLoader.appendChild(counter);
  loaderWrapper.appendChild(outerLoader);
  loaderBlock.appendChild(loaderWrapper);

  return loaderBlock;
}

function createBtn({ label, onClick, id = null, classList = [] }) {
  const btn = document.createElement('button');
  classList.forEach((cls) => {
    btn.classList.add(cls);
  });
  if (id) btn.id = id;
  btn.innerHTML = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderDownload(data) {
  const id = 'download-block';
  const { tabId, candidates } = data;

  const oldMainBlock = document.querySelector('#parse-block');
  if (oldMainBlock) oldMainBlock.remove();

  const downloadBlock = document.querySelector(`#${id}`);

  if (downloadBlock) return;

  const newButton = createBtn({
    classList: ['main-btn'],
    label: `Download ${candidates.length} applicants`,
    onClick: () => downloadData(JSON.stringify(candidates, null, 4), `${title}.json`),
  });

  renderMainBlock({
    message: `Done! Now you can download <b>${candidates.length} applicants</b> from <b>${title}</b>`,
    icon: 'download',
    btn: newButton,
    id,
  });
}

function renderCount({ count }) {
  const counter = document.querySelector('.counter');
  if (counter) counter.innerText = count;
}

function renderMainBlock({ message, icon, btn, id = null }) {
  const mainBlock = document.createElement('div');
  mainBlock.classList.add('main-block');

  if (id) mainBlock.id = id;

  const iconBlock = document.createElement('div');
  const iconTag = document.createElement('img');
  iconTag.src = `images/${icon}.svg`;
  iconTag.classList.add('main-icon');
  iconBlock.appendChild(iconTag);
  mainBlock.appendChild(iconBlock);

  const messageBlock = document.createElement('div');
  messageBlock.innerHTML = `
  <div class="main-message">${message}</div>`;
  mainBlock.appendChild(messageBlock);

  mainBlock.appendChild(btn);

  container.insertBefore(mainBlock, footer);
}

//function hidrateCloseBtn() {
//  const btn = document.querySelector(`.close-btn`);
//  btn.onclick = () => {
//    window.close();
//  };
//}

function hidrateOpenLnBtn() {
  const btn = document.querySelector(`#go-ln-btn`);
  btn.onclick = () => {
    const targetUrl = 'https://www.linkedin.com/my-items/posted-jobs/';

    chrome.tabs.query({ url: '*://www.linkedin.com/*' }, function (tabs) {
      if (tabs.length > 0) {
        let found = false;
        for (let tab of tabs) {
          if (tab.url === targetUrl) {
            chrome.tabs.update(tab.id, { active: true });
            found = true;
            break;
          }
        }
        if (!found) {
          chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
        }
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
  };
}

function hideOpenLnBtn() {
  const btn = document.querySelector(`#go-ln-btn`);
  btn.classList.add('hidden');
}

function showOpenLnBtn() {
  const btn = document.querySelector(`#go-ln-btn`);
  btn.classList.remove('hidden');
}

// file --------------------
function downloadData(data, filename) {
  var fileBlob = new Blob([data], { type: 'text/json' });
  var downloadLink = document.createElement('a');
  downloadLink.download = filename;
  downloadLink.href = window.URL.createObjectURL(fileBlob);
  downloadLink.style.display = 'none';
  document.body.appendChild(downloadLink);
  downloadLink.click();
}

function replacer(key, value) {
  if (typeof value === 'string') {
    return value.replace(/"/g, '""');
  }
  return value;
}

//=============
async function sendTabMessage(tabId, type, data, withError = false) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError.message);
        if (withError) {
          reject();
        } else {
          resolve(false);
        }
      } else {
        resolve(response);
      }
    });
  });
}

//  utils
async function withRetry(fn, times, interval) {
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === times - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}
