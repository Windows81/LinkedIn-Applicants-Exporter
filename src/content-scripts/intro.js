function getCookie(name = 'accessToken') {
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return cookieValue;
    }
  }
  return null;
}

try {
  chrome.runtime.onMessage.addListener((obj, sender, response) => {
    if (obj.type === 'CHECK_AUTH') {
      const token = getCookie();
      response(!!token);
    }
  });
} catch (error) {
  console.error('error: from listener ', error);
}
