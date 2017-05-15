/* eslint-env node */

const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('crypto');

const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const wss = new WebSocket.Server({ host: cfg.host, port: cfg.port });
console.log(`Started server on ${cfg.host}:${cfg.port}`);

function getAddress(ws) {
  if (cfg.x_forwarded_for) return ws.upgradeReq.headers['x-forwarded-for'];
  return ws.upgradeReq.connection.remoteAddress;
}

function send(obj, ws) {
  try {
    ws.send(JSON.stringify(Object.assign({ time: Date.now() }, obj)));
  } catch (err) {
    console.log(err);
  }
}

function nicknameValid(nick) {
  return /^[a-zA-Z0-9_]{1,24}$/.test(nick);
}

function hash(password) {
  const sha = crypto.createHash('sha256');
  sha.update(password + cfg.salt);
  return sha.digest('base64').substr(0, 6);
}

function broadcast(obj, channel) {
  wss.clients
    .filter(ws => (channel ? ws.channel === channel : ws.channel))
    .forEach((ws) => { send(obj, ws); });
}

function isAdmin(client) {
  return client.nick === cfg.admin;
}

function isMod(client) {
  if (isAdmin(client)) return true;
  if (cfg.mods) {
    if (client.trip && cfg.mods.indexOf(client.trip) > -1) {
      return true;
    }
  }
  return false;
}

const police = {
  records: new Map(),
  halflife: 30000, // ms
  threshold: 15,

  loadJail(filename) {
    if (!fs.existsSync(filename)) {
      return;
    }
    fs.readFileSync(filename, 'utf8')
      .split('\n')
      .forEach((id) => { this.arrest(id); });
    console.log(`Loaded jail ${filename}`);
  },

  arrest(id) {
    const record = this.getRecord(id);
    if (record) {
      record.arrested = true;
    }
  },

  getRecord(id) {
    if (this.records.has(id)) return this.records.get(id);
    const record = {
      time: Date.now(),
      score: 0,
      arrested: false,
    };
    this.records.set(id, record);
    return record;
  },

  frisk(id, deltaScore) {
    const record = this.getRecord(id);
    if (record.arrested) return true;
    record.score = record.store*2**(-(Date.now()-record.time)/this.halflife)+deltaScore;
    record.time = Date.now();
    return record.score >= this.threshold;
  },

  pardon(id) {
    const record = this.getRecord(id);
    if (record) {
      record.arrested = false;
    }
  },
};
police.loadJail('jail.txt');

// `this` bound to client
const Client = {
  ping() {},

  join({ channel, nick }) {
    if (police.frisk(getAddress(this), 3)) {
      send({ cmd: 'warn', text: 'You are joining channels too fast. Wait a moment and try again.' }, this);
      return;
    }
    if (this.nick) { return; }
    if (!channel) { return; }
    const [nickname, password] = nick.split('#', 2);
    if (!nicknameValid(nickname)) {
      send({ cmd: 'warn', text: 'Nickname must consist of up to 24 letters, numbers, and underscores' }, this);
      return;
    }
    if (nickname === cfg.admin) {
      if (password !== cfg.password) {
        send({ cmd: 'warn', text: 'Cannot impersonate the admin' }, this);
        return;
      }
    } else if (password) {
      this.trip = hash(password);
    }
    if (wss.clients.some(client =>
      client.channel === channel && client.nick.toLowerCase() === nickname.toLowerCase())
    ) {
      send({ cmd: 'warn', text: 'Nickname taken' }, this);
      return;
    }
    this.channel = channel;
    this.nick = nickname;
    broadcast({ cmd: 'onlineAdd', nick: nickname }, channel);
    send({
      cmd: 'onlineSet',
      nicks: wss.clients.filter(client => client.channel === channel).map(client => client.nick),
    }, this);
  },

  chat({ text }) {
    if (!this.channel) { return; }
    const cleantext = text.replace(/^\s*\n|^\s+$|\n\s*$/g, '').replace(/\n{3,}/g, '\n\n');
    if (!cleantext) { return; }
    if (police.frisk(getAddress(this), cleantext.length/83/4)) {
      send({ cmd: 'warn', text: 'You are sending too much text. Wait a moment and try again.\nPress the up arrow key to restore your last message.' }, this);
      return;
    }
    const data = { cmd: 'chat', nick: this.nick, text: cleantext };
    if (isAdmin(this)) {
      data.admin = true;
    } else if (isMod(this)) {
      data.mod = true;
    }
    if (this.trip) data.trip = this.trip;
    broadcast(data, this.channel);
  },

  invite({ nick }) {
    if (!this.channel) return;
    if (police.frisk(getAddress(this), 2)) {
      send({ cmd: 'warn', text: 'You are sending invites too fast. Wait a moment before trying again.' }, this);
      return;
    }
    const friend = wss.clients.find(client =>
      client.channel === this.channel && client.nick === nick
    );
    if (!friend) {
      send({ cmd: 'warn', text: 'Could not find user in channel' }, this);
      return;
    }
    if (friend === this) return;
    const channel = Math.random().toString(36).substr(2, 8);
    send({ cmd: 'info', text: `You invited ${friend.nick} to ?${channel}` }, this);
    send({ cmd: 'info', text: `${this.nick} invited you to ?${channel}` }, friend);
  },

  stats() {
    const ips = new Set();
    const channels = new Set();
    wss.clients.forEach((client) => {
      if (!client.channel) return;
      channels.add(client.channel);
      ips.add(getAddress(client));
    });
    send({ cmd: 'info', text: `${ips.size} unique IPs in ${channels.size} channels` }, this);
  },

  // Moderator-only commands below this point

  ban({ nick }) {
    if (!isMod(this)) return;
    if (!this.channel) return;
    const badClient = wss.clients.find(
      client => client.channel === this.channel && client.nick === nick,
      this
    );
    if (!badClient) {
      send({ cmd: 'warn', text: `Could not find ${nick}` }, this);
      return;
    }
    if (isMod(badClient)) {
      send({ cmd: 'warn', text: 'Cannot ban moderator' }, this);
      return;
    }
    police.arrest(getAddress(badClient));
    console.log(`${this.nick} [${this.trip}] banned ${nick} in ${this.channel}`);
    broadcast({ cmd: 'info', text: `Banned ${nick}` }, this.channel);
  },

  unban({ ip }) {
    if (!isMod(this)) return;
    if (!this.channel) return;
    police.pardon(ip);
    console.log(`${this.nick} [${this.trip}] unbanned ${ip} in ${this.channel}`);
    send({ cmd: 'info', text: `Unbanned ${ip}` }, this);
  },

  // Admin-only commands below this point

  listUsers() {
    if (!isAdmin(this)) return;
    const channels = new Map();
    wss.clients.forEach((client) => {
      if (!client.channel) return;
      if (!channels.has(client.channel)) channels.set(client.channel, []);
      channels.get(client.channel).push(client.nick);
    });
    const lines = Array.from(channels).map(([channel, users]) => `?${channel} ${users.join(', ')}`);
    send({ cmd: 'info', text: `${wss.clients.length} users online:\n\n${lines.join('\n')}` }, this);
  },

  broadcast({ text }) {
    if (!isAdmin(this)) return;
    broadcast({ cmd: 'info', text: `Server broadcast: ${text}` });
  },
};

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      if (police.frisk(getAddress(ws), 0)) {
        send({ cmd: 'warn', text: 'Your IP is being rate-limited or blocked.' }, ws);
        return;
      }
      police.frisk(getAddress(ws), 1);
      if (data.length > 65536) return;
      const args = JSON.parse(data);
      if (Client.hasOwnProperty(args.cmd)) {
        Client[args.cmd].call(ws, args);
      }
    } catch (err) {
      console.warn(err.stack);
    }
  });
  ws.on('close', () => {
    if (ws.channel) {
      broadcast({ cmd: 'onlineRemove', nick: ws.nick }, ws.channel);
    }
  });
});

