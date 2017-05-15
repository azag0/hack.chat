/* eslint-env browser */
/* global renderMathInElement */

const frontpage = `
                       _           _         _       _
                      | |_ ___ ___| |_   ___| |_ ___| |_
                      |   |_ ||  _| '_| |  _|   |_ ||  _|
                      |_|_|__/|___|_,_|.|___|_|_|__/|_|


Welcome to hack.chat, a minimal, distraction-free chat application.
Channels are created and joined by going to https://${document.domain}/?your-channel. There are no channel lists, so a secret channel name can be used for private discussions.

Here's a random channel generated just for you: ?${Math.random().toString(36).substr(2, 8)}


Formatting:
Whitespace is preserved, so source code can be pasted verbatim.
Surround LaTeX with a dollar sign for inline style $\\zeta(2) = \\pi^2/6$, and two dollars for display. $$\\int_0^1 \\int_0^1 \\frac{1}{1-xy} dx dy = \\frac{\\pi^2}{6}$$

Forked from: https://github.com/AndrewBelt/hack.chat
Android apps: https://goo.gl/UkbKYy https://goo.gl/qasdSu

Server and web client released under the MIT open source license.`.slice(1);

function $(query) { return document.querySelector(query); }

function localStorageGet(key) {
  try {
    return window.localStorage[key];
  } catch (err) {
    return null;
  }
}

function localStorageSet(key, val) {
  try {
    window.localStorage[key] = val;
  } catch (err) {
    // continue regardless
  }
}


let ws;
let myNick = localStorageGet('my-nick');
const myChannel = window.location.search.replace(/^\?/, '');
const lastSent = [''];
let lastSentPos = 0;

function send(data) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Ping server every 50 seconds to retain WebSocket connection
window.setInterval(() => {
  send({ cmd: 'ping' });
}, 50000);

function isAtBottom() {
  return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 1);
}

function updateInputSize() {
  const atBottom = isAtBottom();

  const input = $('#chatinput');
  input.style.height = 0;
  input.style.height = `${input.scrollHeight}px`;
  document.body.style.marginBottom = `${$('#footer').offsetHeight}px`;

  if (atBottom) {
    window.scrollTo(0, document.body.scrollHeight);
  }
}

function insertAtCursor(text) {
  const input = $('#chatinput');
  const start = input.selectionStart || 0;
  let before = input.value.substr(0, start);
  const after = input.value.substr(start);
  before += text;
  input.value = before + after;
  input.selectionStart = before.length;
  input.selectionEnd = before.length;
  updateInputSize();
}

function parseLinks(g0) {
  const a = document.createElement('a');
  a.innerHTML = g0;
  const url = a.textContent;
  a.href = url;
  a.target = '_blank';
  return a.outerHTML;
}

let unread = 0;
let windowActive = true;

function updateTitle() {
  if (windowActive && isAtBottom()) {
    unread = 0;
  }

  let title;
  if (myChannel) {
    title = `?${myChannel}`;
  } else {
    title = 'hack.chat';
  }
  if (unread > 0) {
    title = `(${unread}) ${title}`;
  }
  document.title = title;
}

function pushMessage(args) {
 // Message container
  const messageEl = document.createElement('div');
  messageEl.classList.add('message');

  if (args.nick === myNick) {
    messageEl.classList.add('me');
  } else if (args.nick === '!') {
    messageEl.classList.add('warn');
  } else if (args.nick === '*') {
    messageEl.classList.add('info');
  } else if (args.admin) {
    messageEl.classList.add('admin');
  } else if (args.mod) {
    messageEl.classList.add('mod');
  }

 // Nickname
  const nickSpanEl = document.createElement('span');
  nickSpanEl.classList.add('nick');
  messageEl.appendChild(nickSpanEl);

  if (args.trip) {
    const tripEl = document.createElement('span');
    tripEl.textContent = `${args.trip} `;
    tripEl.classList.add('trip');
    nickSpanEl.appendChild(tripEl);
  }

  if (args.nick) {
    const nickLinkEl = document.createElement('a');
    nickLinkEl.textContent = args.nick;
    nickLinkEl.onclick = function onclick() {
      insertAtCursor(`@${args.nick} `);
      $('#chatinput').focus();
    };
    const date = new Date(args.time || Date.now());
    nickLinkEl.title = date.toLocaleString();
    nickSpanEl.appendChild(nickLinkEl);
  }

 // Text
  const textEl = document.createElement('pre');
  textEl.classList.add('text');

  textEl.textContent = args.text || '';
  textEl.innerHTML = textEl.innerHTML.replace(/(\?|https?:\/\/)\S+?(?=[,.!?:)]?\s|$)/g, parseLinks);

  if ($('#parse-latex').checked) {
  // Temporary hotfix for \rule spamming, see https://github.com/Khan/KaTeX/issues/109
    textEl.innerHTML = textEl.innerHTML.replace(/\\rule|\\\\\s*\[.*?\]/g, '');
    try {
      renderMathInElement(textEl, { delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
      ] });
    } catch (e) {
      console.warn(e);
    }
  }

  messageEl.appendChild(textEl);

 // Scroll to bottom
  const atBottom = isAtBottom();
  $('#messages').appendChild(messageEl);
  if (atBottom) {
    window.scrollTo(0, document.body.scrollHeight);
  }

  unread += 1;
  updateTitle();
}

const ignoredUsers = [];
const onlineUsers = [];

function showNotification(message) {
  if (window.Notification && Notification.permission === 'granted') {
    const options = {
      body: message,
      tag: myChannel,
      icon: 'favicon.ico',
    };
    const n = new Notification(`hack.chat/?${myChannel}`, options);
    setTimeout(n.close.bind(n), 10000);
  }
}

function usersClear() {
  const users = $('#users');
  while (users.firstChild) {
    users.removeChild(users.firstChild);
  }
  onlineUsers.length = 0;
}

function userInvite(nick) {
  send({ cmd: 'invite', nick });
}

function userAdd(nick) {
  const user = document.createElement('a');
  user.textContent = nick;
  user.onclick = function onclick() {
    userInvite(nick);
  };
  const userLi = document.createElement('li');
  userLi.appendChild(user);
  $('#users').appendChild(userLi);
  onlineUsers.push(nick);
}

function userRemove(nick) {
  const users = $('#users');
  Array.from(users.children).forEach((user) => {
    if (user.textContent === nick) {
      users.removeChild(user);
    }
  });
  const index = onlineUsers.indexOf(nick);
  if (index >= 0) {
    onlineUsers.splice(index, 1);
  }
}

const COMMANDS = {
  chat(args) {
    if (ignoredUsers.indexOf(args.nick) >= 0) {
      return;
    }
    pushMessage(args);
    if (!windowActive) {
      if (($('#notify-chat').checked && args.nick !== myNick)
     || ($('#notify-mentions').checked && args.text.indexOf(`@${myNick}`) !== -1)) {
        showNotification(`<${args.nick}> ${args.text}`);
      }
    }
  },
  info(args) {
    pushMessage(Object.assign({}, args, { nick: '*' }));
    if (!windowActive && $('#notify-info').checked) {
      showNotification(`<*> ${args.text}`);
    }
  },
  warn(args) {
    pushMessage(Object.assign({}, args, { nick: '!' }));
    if (!windowActive && $('#notify-info').checked) {
      showNotification(`<!> ${args.text}`);
    }
  },
  onlineSet(args) {
    const nicks = args.nicks;
    usersClear();
    nicks.forEach((nick) => {
      userAdd(nick);
    });
    pushMessage({ nick: '*', text: `Users online: ${nicks.join(', ')}` });
  },
  onlineAdd(args) {
    const nick = args.nick;
    userAdd(nick);
    if ($('#joined-left').checked) {
      pushMessage({ nick: '*', text: `${nick} joined` });
    }
    if (!windowActive && $('#notify-info').checked) {
      showNotification(`<*> ${args.nick} joined`);
    }
  },
  onlineRemove(args) {
    const nick = args.nick;
    userRemove(nick);
    if ($('#joined-left').checked) {
      pushMessage({ nick: '*', text: `${nick} left` });
    }
    if (!windowActive && $('#notify-info').checked) {
      showNotification(`<*> ${args.nick} left`);
    }
  },
};


function join(channel) {
  if (document.location.protocol === 'https:') {
    ws = new WebSocket(`wss://${document.domain}/chat-ws`);
  } else {
    ws = new WebSocket(`ws://${document.domain}:6060`);
  }

  let wasConnected = false;

  ws.onopen = function onopen() {
    if (!wasConnected) {
      if (location.hash) {
        myNick = location.hash.substr(1);
      } else {
        myNick = prompt('Nickname:', myNick);
      }
    }
    if (myNick) {
      localStorageSet('my-nick', myNick);
      send({ cmd: 'join', channel, nick: myNick });
    }
    wasConnected = true;
  };

  ws.onclose = function onclose() {
    if (wasConnected) {
      pushMessage({ nick: '!', text: 'Server disconnected. Attempting to reconnect...' });
    }
    window.setTimeout(() => {
      join(channel);
    }, 2000);
  };

  ws.onmessage = function onmessage(message) {
    const args = JSON.parse(message.data);
    const cmd = args.cmd;
    const command = COMMANDS[cmd];
    command.call(null, args);
  };
}

window.onfocus = function onfocus() {
  windowActive = true;
  updateTitle();
};

window.onblur = function onblur() {
  windowActive = false;
};

window.onscroll = function onscroll() {
  if (isAtBottom()) {
    updateTitle();
  }
};

/* footer */

$('#footer').onclick = function onclick() {
  $('#chatinput').focus();
};

$('#chatinput').onkeydown = function onkeydown(e) {
  if (e.keyCode === 13 /* ENTER */ && !e.shiftKey) {
    e.preventDefault();
  // Submit message
    if (e.target.value !== '') {
      const text = e.target.value;
      e.target.value = '';
      send({ cmd: 'chat', text });
      lastSent[0] = text;
      lastSent.unshift('');
      lastSentPos = 0;
      updateInputSize();
    }
  } else if (e.keyCode === 38 /* UP */) {
  // Restore previous sent messages
    if (e.target.selectionStart === 0 && lastSentPos < lastSent.length - 1) {
      e.preventDefault();
      if (lastSentPos === 0) {
        lastSent[0] = e.target.value;
      }
      lastSentPos += 1;
      e.target.value = lastSent[lastSentPos];
      e.target.selectionStart = e.target.value.length;
      e.target.selectionEnd = e.target.value.length;
      updateInputSize();
    }
  } else if (e.keyCode === 40 /* DOWN */) {
    if (e.target.selectionStart === e.target.value.length && lastSentPos > 0) {
      e.preventDefault();
      lastSentPos -= 1;
      e.target.value = lastSent[lastSentPos];
      e.target.selectionStart = 0;
      e.target.selectionEnd = 0;
      updateInputSize();
    }
  } else if (e.keyCode === 27 /* ESC */) {
    e.preventDefault();
  // Clear input field
    e.target.value = '';
    lastSentPos = 0;
    lastSent[lastSentPos] = '';
    updateInputSize();
  } else if (e.keyCode === 9 /* TAB */) {
  // Tab complete nicknames starting with @
    e.preventDefault();
    const pos = e.target.selectionStart || 0;
    const text = e.target.value;
    const index = text.lastIndexOf('@', pos);
    if (index >= 0) {
      const stub = text.substring(index + 1, pos).toLowerCase();
   // Search for nick beginning with stub
      const nicks = onlineUsers.filter(nick => nick.toLowerCase().indexOf(stub) === 0);
      if (nicks.length === 1) {
        insertAtCursor(`${nicks[0].substr(stub.length)} `);
      }
    }
  }
};


$('#chatinput').oninput = function oninput() {
  updateInputSize();
};

updateInputSize();


/* sidebar */

$('#sidebar').onmouseenter = function onmouseenter(e) {
  $('#sidebar-content').classList.remove('hidden');
  e.stopPropagation();
};
$('#sidebar').ontouchstart = $('#sidebar').onmouseenter;

$('#sidebar').onmouseleave = function onmouseleave() {
  if (!$('#pin-sidebar').checked) {
    $('#sidebar-content').classList.add('hidden');
  }
};
document.ontouchstart = $('#sidebar').onmouseleave;

$('#clear-messages').onclick = function onclick() {
 // Delete children elements
  const messages = $('#messages');
  while (messages.firstChild) {
    messages.removeChild(messages.firstChild);
  }
};

// Restore settings from localStorage

if (localStorageGet('pin-sidebar') === 'true') {
  $('#pin-sidebar').checked = true;
  $('#sidebar-content').classList.remove('hidden');
}
if (localStorageGet('joined-left') === 'false') {
  $('#joined-left').checked = false;
}
if (localStorageGet('parse-latex') === 'false') {
  $('#parse-latex').checked = false;
}
if (window.Notification && Notification.permission === 'granted') {
  if (localStorageGet('notify-chat') === 'true') {
    $('#notify-chat').checked = true;
  }
  if (localStorageGet('notify-mentions') === 'true') {
    $('#notify-mentions').checked = true;
  }
  if (localStorageGet('notify-info') === 'true') {
    $('#notify-info').checked = true;
  }
}

// Disable browser notifications toggle if notifications denied or not available
if (!window.Notification || Notification.permission === 'denied') {
  $('#notify-chat').disabled = true;
  $('#notify-chat').checked = false;
  $('#notify-mentions').disabled = true;
  $('#notify-mentions').checked = false;
  $('#notify-info').disabled = true;
  $('#notify-info').checked = false;
}

$('#pin-sidebar').onchange = function onchange(e) {
  localStorageSet('pin-sidebar', !!e.target.checked);
};
$('#joined-left').onchange = function onchange(e) {
  localStorageSet('joined-left', !!e.target.checked);
};
$('#parse-latex').onchange = function onchange(e) {
  localStorageSet('parse-latex', !!e.target.checked);
};

/* color scheme switcher */

const schemes = [
  'android',
  'atelier-dune',
  'atelier-forest',
  'atelier-heath',
  'atelier-lakeside',
  'atelier-seaside',
  'bright',
  'chalk',
  'default',
  'eighties',
  'greenscreen',
  'mocha',
  'monokai',
  'nese',
  'ocean',
  'pop',
  'railscasts',
  'solarized',
  'tomorrow',
];

let currentScheme = 'atelier-dune';

function setScheme(scheme) {
  currentScheme = scheme;
  $('#scheme-link').href = `/schemes/${scheme}.css`;
  localStorageSet('scheme', scheme);
}

// Add scheme options to dropdown selector
schemes.forEach((scheme) => {
  const option = document.createElement('option');
  option.textContent = scheme;
  option.value = scheme;
  $('#scheme-selector').appendChild(option);
});

$('#scheme-selector').onchange = function onchange(e) {
  setScheme(e.target.value);
};

// Load sidebar configaration values from local storage if available
if (localStorageGet('scheme')) {
  setScheme(localStorageGet('scheme'));
}

$('#scheme-selector').value = currentScheme;


/* main */

if (myChannel === '') {
  pushMessage({ text: frontpage });
  $('#footer').classList.add('hidden');
  $('#sidebar').classList.add('hidden');
} else {
  join(myChannel);
}
