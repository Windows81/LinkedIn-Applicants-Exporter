
var searchParams = {};
var jobTitle = '';

(async () => {
  console.log('window.hasAddedMessageListener: ', window.hasAddedMessageListener);

  if (!window.hasAddedMessageListener) {
    chrome.runtime.onMessage.addListener((obj, sender, response) => {
      window.hasAddedMessageListener = true;


      if (obj.type === 'GET_JOB_METADATA_POPUP') {
        (async () => {
          const { title, count } = await parseJobDataInCandidatesPage();
          jobTitle = title;
          response({ tabId: obj.data.tabId, title, count });
        })();
        return true;
      }

      if (obj.type === 'PARSE_APPLICANTS') {

        searchParams = getSearchParamsAsObject(window.location.search);

        (async () => {
          const candidates = await parseCandidates(Date.now());
          chrome.runtime.sendMessage({
            type: 'PARSED_APPLICANTS',
            data: { tabId: obj.data.tabId, candidates },
          });
        })();
      }

    });
  }
})();

//================
function getSearchParamsAsObject(url) {
  let sp = new URLSearchParams(url);
  let paramsObject = {};

  sp.forEach((value, key) => {
    if (paramsObject[key]) {
      // If the key already exists, convert it to an array (if it's not already)
      if (!Array.isArray(paramsObject[key])) {
        paramsObject[key] = [paramsObject[key]];
      }
      paramsObject[key].push(value);
    } else {
      paramsObject[key] = value;
    }
  });

  return paramsObject;
}




// xPath ------------------------------------

function getElementByXPath(xpath, container, single = true) {
  const result = document.evaluate(
    xpath,
    container,
    null,
    single
      ? XPathResult.FIRST_ORDERED_NODE_TYPE
      : XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );

  return single ? result.singleNodeValue : result;
}

// parse =============

async function parseJobDataInCandidatesPage() {
  const container = await waitForDomSimple(() =>
    document.querySelector('.hiring-job-top-card')
  );

  const jobTitleBlock = await waitForDomSimple(() =>
    getElementByXPath('div[1]/div[1]/div[2]/div[1]/h1', container)
  );

  let jobTitle = '';

  jobTitleBlock.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      jobTitle += node.textContent.trim();
    }
  });

  const applicantsCountBlock = document.querySelector(
    '.hiring-applicants__count'
  );
  const applicantsCountContent = await waitForDomSimple(() =>
    getElementByXPath('span', applicantsCountBlock)
  );

  const content = applicantsCountContent.innerText;
  let count = 0;

  const match = content.match(/\((\d+)/);

  if (match) {
    count = parseInt(match[1], 10);
  } else {
    count = parseInt(content, 10);
  }

  return { title: jobTitle, count };
}

async function gatherApplicantsIds() {
  const candidates = [];
  const container = await waitForDomSimple(() =>
    document.querySelector('.hiring-applicants__content')
  );

  const pagUrl = await requestPagUrlFromBack()

  const paginationBlock = document.querySelector('.artdeco-pagination');

  if (paginationBlock) {


    let isNextPage = true;
    let pageIndex = 1;



    while (isNextPage) {
      const pageResponse = await fetchNextPage(pageIndex, pagUrl);
      if (pageResponse.included.length) {
        const array =
          pageResponse.data.data.hiringDashJobApplicationsByCriteria[
          '*elements'
          ];

        const pageCandidates = array.map((el) =>
          extractJobApplicationNumbers(el)
        );

        candidates.push(...pageCandidates.flat());
      } else {
        isNextPage = false;
      }
      pageIndex += 1;
    }
  } else {
    if (container) {
      const list = await waitForDomSimple(() =>
        getElementByXPath('div[1]/div[2]/ul', container)
      );
      for (let index = 1; index < list.children.length + 1; index++) {
        const candidate = {};
        const nameBlock = await waitForDomSimple(() =>
          getElementByXPath(
            `li[${index}]/a/div[1]/div[2]/div[contains(@class, 'title')]`,
            list
          )
        );

        const elementWithMetadata = await waitForDomSimple(() =>
          getElementByXPath(`li[${index}]/a/div[1]/div[2]`, list)
        );

        const metadata = await waitForDomSimple(() =>
          getElementByXPath(
            `div[contains(@class, 'metadata')]`,
            elementWithMetadata,
            false
          )
        );

        const anchor = await waitForDomSimple(() =>
          getElementByXPath(`li[${index}]/a`, list)
        );

        const applicationId = anchor.href.split('/')[7];
        candidate.applicationId = applicationId;
        candidates.push(candidate);
      }
    }
  }

  return { candidates, pagUrl };
}

async function parseCandidates(timestamp) {
  let candidates = []
  let pagUrl = ''
  try {
    const resultIds = await gatherApplicantsIds();

    const { candidates: _candidates, pagUrl: _pagUrl } = resultIds;
    candidates = _candidates
    pagUrl = _pagUrl

  } catch (error) {
    console.log('error: ', error);
    chrome.runtime.sendMessage({
      type: 'DEBUG_DATA_APPLICANT',
      data: { timestamp, error: JSON.stringify(error), url: pagUrl, jobTitle },
    });
  }


  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];

    let result = { included: [] };

    try {
      result = await fetchJobApplication(
        candidate.applicationId,
        candidate.href
      );
    } catch (error) {
      console.log('error: =============================== ', error);
      chrome.runtime.sendMessage({
        type: 'DEBUG_DATA_APPLICANT',
        data: { timestamp, index, error: JSON.stringify(result), url: pagUrl, jobTitle },
      });
    }

    if (result.included && result.included.length) {

      const candidateFromIncluded = parseCandidateData(result.included);

      candidates[index] = {
        ...candidate,
        ...candidateFromIncluded,
      };

      console.log('index: ====', index);


      chrome.runtime.sendMessage({
        type: 'PARSED_APPLICANTS_COUNT',
        data: { count: index + 1 },
      });

      chrome.runtime.sendMessage({
        type: 'DEBUG_DATA_APPLICANT',
        data: {
          index,
          timestamp,
          raw: result.included,
          parsed: candidateFromIncluded,
          url: pagUrl,
          jobTitle
        },
      });

    } else {
      chrome.runtime.sendMessage({
        type: 'DEBUG_DATA_APPLICANT',
        data: {
          timestamp, index,
          error: JSON.stringify(result), url: window.location.href,
          jobTitle
        },
      });
    }

  }

  return prepareCandidates(candidates);

}

function parseCandidateData(array) {
  const candidate = { expirience: [], education: [] };
  array.forEach((item) => {
    if (item.lastName) {
      candidate.name = item.firstName + ' ' + item.lastName;
      candidate.headline = item.headline;
    }
    if (item.contactEmail) {
      candidate.email = item.contactEmail;
    }
    if (item.contactPhoneNumber) {
      candidate.phoneNumber = item.contactPhoneNumber.number;
    }
    if (
      item.defaultLocalizedName &&
      item.defaultLocalizedNameWithoutCountryName
    ) {
      candidate.loc = item.defaultLocalizedName;
    }
    if (item.createdAt) {
      candidate.createdAt = new Date(item.createdAt);
    }

    if (item.profileTreasuryMediaPosition) {
      const start =
        item.dateRange?.start?.month + ' ' + item.dateRange?.start?.year;
      const end = item.dateRange?.end
        ? item.dateRange?.end.month + ' ' + item.dateRange?.end.year
        : 'present';

      const name = item.companyName;
      const position = item.title;
      const geo = item.geoLocationName;

      const year = item.dateRange?.start?.year;
      const month = item.dateRange?.start?.month;

      candidate.expirience.push({
        start,
        end,
        name,
        position,
        geo,
        year,
        month,
      });
    }
    if (item.profileTreasuryMediaEducation) {
      const start = item.dateRange?.start?.year || 1900;
      const end = item.dateRange?.end?.year || 'present';

      const scool = item.schoolName;
      const field = item.fieldOfStudy;
      const degree = item.degreeName;

      candidate.education.push({ start, end, scool, field, degree });
    }
  });

  return candidate;
}

function prepareCandidates(candidates) {
  const prepared = candidates.map((item) => {
    const newItem = { ...item };

    const education = item.education
      .sort((a, b) => b.start - a.start)
      .map((ed) => {
        const array = [];
        if (ed.start) array.push(ed.start + ' - ' + ed.end);
        if (ed.scool) array.push(ed.scool);
        if (ed.field) array.push(ed.field);
        if (ed.degree) array.push(ed.degree);

        return array.join(', ');
      });

    education.forEach((item, index) => {
      newItem[`education_${index + 1}`] = item;
    });

    delete newItem.education;

    const expirience = item.expirience
      .sort((a, b) => {
        if (a.year !== b.year) {
          return b.year - a.year;
        } else {
          return b.month - a.month;
        }
      })
      .map((exp) => {
        const array = [];
        if (exp.start) array.push(exp.start + ' - ' + exp.end);
        if (exp.name) array.push(exp.name);
        if (exp.position) array.push(exp.position);
        if (exp.geo) array.push(exp.geo);
        return array.join(', ');
      });

    expirience.forEach((item, index) => {
      newItem[`expirience_${index + 1}`] = item;
    });

    delete newItem.expirience;

    return cleanObjectValues(newItem);
  });

  return prepared;
}

// utils --------------------------------
function cleanObjectValues(obj) {
  const cleanedObj = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && obj[key] && typeof obj[key] === 'string') {
      cleanedObj[key] = obj[key]
        .replace(/"/g, "'")
        .replace(/\n\s*/g, '')
        .replace(/\\/g, '')
        .trim();
    } else {
      cleanedObj[key] = obj[key];
    }
  }
  return cleanedObj;
}

async function waitForDomSimple(queryFn) {
  let _isReady = false;
  let _domNode = null;

  while (!_isReady) {
    _domNode = queryFn();
    if (_domNode) _isReady = true;
    await delay(100);
  }
  return _domNode;
}

async function waitForDomComplex(queryFn, interval = 300) {
  let _isReady = false;
  let _domNode = null;
  let _data = {};

  while (!_isReady) {
    const { domNode, isReady, data } = queryFn();
    if (isReady) _isReady = true;
    _domNode = domNode;
    _data = data;
    await delay(interval);
  }
  return { domNode: _domNode, data: _data };
}

async function delay(msec) {
  return new Promise((resolve) => {
    setTimeout(resolve, msec);
  });
}

function safeParse(string) {
  let obj = {};
  try {
    obj = JSON.parse(string);
  } catch (e) {
    console.error("Can't parse string", e);
    return {};
  }
  return obj;
}

function findKeys(obj, keysToFind) {
  let result = {};

  keysToFind.forEach((key) => (result[key] = []));

  function traverse(obj) {
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (keysToFind.includes(key)) {
          if (typeof obj[key] === 'string' || typeof obj[key] === 'number') {
            result[key].push(obj[key]);
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          traverse(obj[key]);
        }
      }
    }
  }

  traverse(obj);
  return result;
}

function getCookie(name) {
  var pattern = RegExp(name + '=.[^;]*');
  var matched = document.cookie.match(pattern);
  if (matched) {
    var cookie = matched[0].split('=');
    return cookie[1];
  }
  return false;
}

// fetch ===========

async function fetchJobApplication(applicationId, link) {
  const csrfToken = getCookie('JSESSIONID').replace(/"/g, '');
  //try {
  //  const queryId = await getQueryId(link);
  //} catch (error) {}

  const queryId = 'b6f283040a32b7f2acab4ad18e0d971d';

  const response = await fetch(
    `https://www.linkedin.com/voyager/api/graphql?variables=(jobApplicationUrns:List(urn%3Ali%3Afsd_jobApplication%3A${applicationId}))&queryId=voyagerHiringDashJobApplications.${queryId}`,
    {
      'headers': {
        'accept': 'application/vnd.linkedin.normalized+json+2.1',
        'accept-language':
          'ru-RU,ru;q=0.9,uk;q=0.8,en-US;q=0.7,en;q=0.6,pl;q=0.5',
        'cache-control': 'no-cache',
        'csrf-token': csrfToken,
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'sec-ch-ua':
          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-li-lang': 'uk_UA',
        'x-li-pem-metadata': 'Voyager - Hiring=applicant-detail-right-pane',
      },
      'method': 'GET',
      'mode': 'cors',
      'credentials': 'include',
    }
  );

  if (!response.ok) {
    console.log('response: ', response);
    //throw new Error('Network response was not ok ' + response.statusText);
  }

  const data = await response.json();

  return data;
}

function chooseSortOrder(sortType) {
  const asc = 'sortOrder:ASCENDING'
  const desc = 'sortOrder:DESCENDING'
  if (['FIRST_NAME', 'LAST_NAME'].includes(sortType)) return asc;
  return desc
}

function createSearchParamsForPage() {
  const resultArray = [];
  console.log('searchParams: ', searchParams);

  if ('sort_by' in searchParams && searchParams['sort_by']) {

    resultArray.push(`${chooseSortOrder(searchParams['sort_by'])},sortType:${searchParams['sort_by']}`)
  }
  if ('r' in searchParams && searchParams['r']) {
    resultArray.push(`ratings:List(${searchParams['r']})`)
  }
  //if ('loc' in searchParams && searchParams['loc']) {
  //  const encoded = encodeURIComponent(searchParams['loc'])
  //    .replace(/\(/g, '%28')
  //    .replace(/\)/g, '%29');
  //  resultArray.push(`placeUrns:List(${encoded})`)
  //}
  if ('yoe' in searchParams && searchParams['yoe']) {
    resultArray.push(`yearsOfExperiences:List(${searchParams['yoe']})`)
  }

  const resultString = resultArray.join(',')

  return resultString.length > 5 ? `,${resultString}` : ''
}

function requestPagUrlFromBack() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'QUERY_PAG_URL' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

function modifyPagUrl(url, start) {
  const modified = url
    .replace(/start:\d+/, `start:${start}`)
    .replace(/count:\d+/, `count:25`);

  return modified
}

function createDefaultUrl(start) {
  const searchParamsString = createSearchParamsForPage()
  console.log('searchParamsString: ', searchParamsString);

  const jobPostingId = _getJobId();

  const url = `https://www.linkedin.com/voyager/api/graphql?variables=(start:${start},count:25,jobPosting:urn%3Ali%3Afsd_jobPosting%3A${jobPostingId}${searchParamsString})&queryId=voyagerHiringDashJobApplications.843c8c719ed6c86c0030f93ba366e2f0`

  return url;

}


async function fetchNextPage(page, pagUrl) {

  const csrfToken = getCookie('JSESSIONID').replace(/"/g, '');
  //const queryId = await getQueryId(link);

  const start = (page - 1) * 25;
  const url = pagUrl ? modifyPagUrl(pagUrl, start) : createDefaultUrl(start);

  const response = await fetch(
    url,
    {
      'headers': {
        'accept': 'application/vnd.linkedin.normalized+json+2.1',
        'accept-language':
          'ru-RU,ru;q=0.9,uk;q=0.8,en-US;q=0.7,en;q=0.6,pl;q=0.5',
        'cache-control': 'no-cache',
        'csrf-token': csrfToken,
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'sec-ch-ua':
          '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-li-lang': 'uk_UA',
        //'x-li-page-instance':
        //'urn:li:page:d_flagship3_hiring_applicant_detail;1UOgywjpTp2YiYVCytjYZA==',
        'x-li-pem-metadata': 'Voyager - Hiring=applicant-detail-right-pane',
        //  'x-li-track':
        //    '{"clientVersion":"1.13.17226","mpVersion":"1.13.17226","osName":"web","timezoneOffset":3,"timezone":"Europe/Kiev","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1.100000023841858,"displayWidth":2112.000045776367,"displayHeight":1188.0000257492065}',
        //  'x-restli-protocol-version': '2.0.0',
      },
      //'referrer':
      //  'https://www.linkedin.com/hiring/jobs/3928101024/applicants/18565365994/detail/?r=UNRATED%2CGOOD_FIT%2CMAYBE',
      //'referrerPolicy': 'strict-origin-when-cross-origin',
      //'body': null,
      'method': 'GET',
      'mode': 'cors',
      'credentials': 'include',
    }
  );

  if (!response.ok) {
    throw new Error('Network response was not ok ' + response.statusText);
  }

  const data = await response.json();
  return data;
}

function _getQueryId() {
  let queryId = null;

  function requestFromBack() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'QUERY_ID_REQUEST' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  async function parseQueryId(link) {
    const resultTexst = await fetch(link, {
      method: 'GET',
    });
    const _text = await resultTexst.text();
    let hashArr = _text.match(
      /voyagerHiringDashJobApplications\.([a-f0-9]{32})/
    );

    const hash = hashArr[1];
    return hash;
  }

  return async function (link) {
    if (queryId) return Promise.resolve(queryId);
    const _queryId = await requestFromBack();
    if (_queryId) {
      queryId = _queryId;
    }
    if (!_queryId) {
      const __queryId = await parseQueryId(link);

      if (__queryId) queryId = __queryId;
    }

    return queryId;
  };
}

var getQueryId = _getQueryId();

function _getJobId() {
  const href = window.location.href;
  const _jobId = href.split('/')[5];
  return _jobId;
}

//--------

function extractJobApplicationNumbers(text) {
  const regex = /fsd_jobApplication:(\d+)/g;
  let match;
  const results = [];

  while ((match = regex.exec(text)) !== null) {
    results.push(match[1]);
  }

  return Array.from(new Set(results)).map((item) => ({ applicationId: item }));
}



//https://www.linkedin.com/hiring/jobs/3935067522/applicants/21463816656/detail/?keyword=&loc=urn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aus%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aua%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Ain%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Amn%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aus%2C534)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aus%2C716)&sort_by=FIRST_NAME



//https://www.linkedin.com/voyager/api/graphql?variables=(start:10,count:15,jobPosting:urn%3Ali%3Afsd_jobPosting%3A3935067522,sortType:FIRST_NAME,sortOrder:ASCENDING,placeUrns:List(urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aus%2C0%29))&queryId=voyagerHiringDashJobApplications.843c8c719ed6c86c0030f93ba366e2f0

//https://www.linkedin.com/voyager/api/graphql?variables=(start:0,count:10,jobPosting:urn%3Ali%3Afsd_jobPosting%3A3935067522,sortType:FIRST_NAME,sortOrder:ASCENDING,placeUrns:List(urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aus%2C0%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aua%2C0%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Ain%2C0%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aus%2C70%29))&queryId=voyagerHiringDashJobApplications.843c8c719ed6c86c0030f93ba366e2f0

//"(start:0,count:10,jobPosting:urn:li:fsd_jobPosting:3935067522,sortType:FIRST_NAME,sortOrder:ASCENDING,placeUrns:List(urn:li:place:(urn:li:country:us,0),urn:li:place:(urn:li:country:ua,0),urn:li:place:(urn:li:country:in,0),urn:li:place:(urn:li:country:us,70)))"


//my
//https://www.linkedin.com/voyager/api/graphql?variables=(start:0,count:25,jobPosting:urn%3Ali%3Afsd_jobPosting%3A3935067522,sortOrder:ASCENDING,sortType:FIRST_NAME,placeUrns:List(urn:li:place:(urn:li:country:us,0),urn:li:place:(urn:li:country:ua,0),urn:li:place:(urn:li:country:in,0),urn:li:place:(urn:li:country:us,70)))&queryId=voyagerHiringDashJobApplications.843c8c719ed6c86c0030f93ba366e2f0


//https://www.linkedin.com/voyager/api/graphql?variables=(start:0,count:10,jobPosting:urn%3Ali%3Afsd_jobPosting%3A3935067522,sortType:FIRST_NAME,sortOrder:ASCENDING,placeUrns:List(urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aus%2C0%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aua%2C0%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Ain%2C0%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aus%2C70%29,urn%3Ali%3Aplace%3A%28urn%3Ali%3Acountry%3Aus%2C732%29))&queryId=voyagerHiringDashJobApplications.843c8c719ed6c86c0030f93ba366e2f0

//my encoded
//,sortOrder:ASCENDING,sortType:FIRST_NAME,placeUrns:List(urn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aus%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aua%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Ain%2C0)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aus%2C70)%2Curn%3Ali%3Aplace%3A(urn%3Ali%3Acountry%3Aus%2C732))