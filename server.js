/* jshint asi: true */
/* jshint esnext: true */

const fs = require('fs');
const ws = require('ws');
const crypto = require('crypto');

let config = {};
function loadConfig(filename) {
  try {
    const data = fs.readFileSync(filename, 'utf8');
    config = JSON.parse(data);
    console.log(`Loaded config ${filename}`);
  } catch (e) {
    console.warn(e);
  }
}

const configFilename = 'config.json';
loadConfig(configFilename);
fs.watchFile(configFilename, { persistent: false }, () => {
  loadConfig(configFilename);
});


const server = new ws.Server({ host: config.host, port: config.port });
console.log(`Started server on ${config.host}:${config.port}`);

// rate limiter
const POLICE = {
  records: {},
  halflife: 30000, // ms
  threshold: 15,

  loadJail(filename) {
    let ids;
    try {
      const text = fs.readFileSync(filename, 'utf8');
      ids = text.split(/\r?\n/);
    } catch (e) {
      return;
    }
    ids.filter(id => id && id[0] !== '#').forEach((id) => { this.arrest(id); });
    console.log(`Loaded jail '${filename}'`);
  },

  search(id) {
    let record = this.records[id];
    if (!record) {
      record = {
        time: Date.now(),
        score: 0,
      };
      this.records[id] = record;
    }
    return record;
  },

  frisk(id, deltaScore) {
    const record = this.search(id);
    if (record.arrested) {
      return true;
    }

    record.score *= 2 ** (-(Date.now() - record.time) / POLICE.halflife);
    record.score += deltaScore;
    record.time = Date.now();
    if (record.score >= this.threshold) {
      return true;
    }
    return false;
  },

  arrest(id) {
    const record = this.search(id);
    if (record) {
      record.arrested = true;
    }
  },

  pardon(id) {
    const record = this.search(id);
    if (record) {
      record.arrested = false;
    }
  },
};

POLICE.loadJail('jail.txt');

function getAddress(client) {
  if (config.x_forwarded_for) {
    // The remoteAddress is 127.0.0.1 since if all connections
    // originate from a proxy (e.g. nginx).
    // You must write the x-forwarded-for header to determine the
    // client's real IP address.
    return client.upgradeReq.headers['x-forwarded-for'];
  }

  return client.upgradeReq.connection.remoteAddress;
}

function send(data, client) {
  // Add timestamp to command
  data.time = Date.now(); // eslint-disable-line no-param-reassign
  try {
    if (client.readyState === ws.OPEN) {
      client.send(JSON.stringify(data));
    }
  } catch (e) {
    // Ignore exceptions thrown by client.send()
  }
}

function nicknameValid(nick) {
  // Allow letters, numbers, and underscores
  return /^[a-zA-Z0-9_]{1,24}$/.test(nick);
}

function hash(password) {
  const sha = crypto.createHash('sha256');
  sha.update(password + config.salt);
  return sha.digest('base64').substr(0, 6);
}

/** Sends data to all clients
channel: if not null, restricts broadcast to clients in the channel
*/
function broadcast(data, channel) {
  server.clients
    .filter(client => (channel ? client.channel === channel : client.channel))
    .forEach((client) => { send(data, client); });
}

function isAdmin(client) {
  return client.nick === config.admin;
}

function isMod(client) {
  if (isAdmin(client)) return true;
  if (config.mods) {
    if (client.trip && config.mods.indexOf(client.trip) > -1) {
      return true;
    }
  }
  return false;
}


// `this` bound to client
const COMMANDS = {
  ping() {
    // Don't do anything
  },

  join(args) {
    let channel = String(args.channel);
    let nick = String(args.nick);

    if (POLICE.frisk(getAddress(this), 3)) {
      send({ cmd: 'warn', text: 'You are joining channels too fast. Wait a moment and try again.' }, this);
      return;
    }

    if (this.nick) {
      // Already joined
      return;
    }

    // Process channel name
    channel = channel.trim();
    if (!channel) {
      // Must join a non-blank channel
      return;
    }

    // Process nickname
    const nickArr = nick.split('#', 2);
    nick = nickArr[0].trim();

    if (!nicknameValid(nick)) {
      send({ cmd: 'warn', text: 'Nickname must consist of up to 24 letters, numbers, and underscores' }, this);
      return;
    }

    const password = nickArr[1];
    if (nick.toLowerCase() === config.admin.toLowerCase()) {
      if (password !== config.password) {
        send({ cmd: 'warn', text: 'Cannot impersonate the admin' }, this);
        return;
      }
    } else if (password) {
      this.trip = hash(password);
    }

    if (server.clients.some(client =>
      client.channel === channel && client.nick.toLowerCase() === nick.toLowerCase())
    ) {
      send({ cmd: 'warn', text: 'Nickname taken' }, this);
      return;
    }

    // Announce the new user
    broadcast({ cmd: 'onlineAdd', nick }, channel);

    // Formally join channel
    this.channel = channel;
    this.nick = nick;

    // Set the online users for new user
    const nicks = [];
    server.clients.filter(client => client.channel === channel)
      .forEach((client) => { nicks.push(client.nick); });
    send({ cmd: 'onlineSet', nicks }, this);
  },

  chat(args) {
    let text = String(args.text);

    if (!this.channel) {
      return;
    }
    // strip newlines from beginning and end
    text = text.replace(/^\s*\n|^\s+$|\n\s*$/g, '');
    // replace 3+ newlines with just 2 newlines
    text = text.replace(/\n{3,}/g, '\n\n');
    if (!text) {
      return;
    }

    const score = text.length / 83 / 4;
    if (POLICE.frisk(getAddress(this), score)) {
      send({ cmd: 'warn', text: 'You are sending too much text. Wait a moment and try again.\nPress the up arrow key to restore your last message.' }, this);
      return;
    }

    const data = { cmd: 'chat', nick: this.nick, text };
    if (isAdmin(this)) {
      data.admin = true;
    } else if (isMod(this)) {
      data.mod = true;
    }
    if (this.trip) {
      data.trip = this.trip;
    }
    broadcast(data, this.channel);
  },

  invite(args) {
    const nick = String(args.nick);
    if (!this.channel) {
      return;
    }

    if (POLICE.frisk(getAddress(this), 2)) {
      send({ cmd: 'warn', text: 'You are sending invites too fast. Wait a moment before trying again.' }, this);
      return;
    }

    const friend = server.clients.find(client =>
      client.channel === this.channel && client.nick === nick
    );
    if (!friend) {
      send({ cmd: 'warn', text: 'Could not find user in channel' }, this);
      return;
    }
    if (friend === this) {
      // Ignore silently
      return;
    }
    const channel = Math.random().toString(36).substr(2, 8);
    send({ cmd: 'info', text: `You invited ${friend.nick} to ?${channel}` }, this);
    send({ cmd: 'info', text: `${this.nick} invited you to ?${channel}` }, friend);
  },

  stats(args) {  // eslint-disable-line no-unused-vars
    const ips = {};
    const channels = {};
    server.clints.filter(client => client.channel).forEach((client) => {
      channels[client.channel] = true;
      ips[getAddress(client)] = true;
    });
    send({ cmd: 'info', text: `${Object.keys(ips).length} unique IPs in ${Object.keys(channels).length} channels` }, this);
  },

  // Moderator-only commands below this point

  ban(args) {
    if (!isMod(this)) {
      return;
    }

    const nick = String(args.nick);
    if (!this.channel) {
      return;
    }

    const badClient = server.clients.filter(
      client => client.channel === this.channel && client.nick === nick,
      this
    )[0];

    if (!badClient) {
      send({ cmd: 'warn', text: `Could not find ${nick}` }, this);
      return;
    }

    if (isMod(badClient)) {
      send({ cmd: 'warn', text: 'Cannot ban moderator' }, this);
      return;
    }

    POLICE.arrest(getAddress(badClient));
    console.log(`${this.nick} [${this.trip}] banned ${nick} in ${this.channel}`);
    broadcast({ cmd: 'info', text: `Banned ${nick}` }, this.channel);
  },

  unban(args) {
    if (!isMod(this)) {
      return;
    }

    const ip = String(args.ip);
    if (!this.channel) {
      return;
    }

    POLICE.pardon(ip);
    console.log(`${this.nick} [${this.trip}] unbanned ${ip} in ${this.channel}`);
    send({ cmd: 'info', text: `Unbanned ${ip}` }, this);
  },

  // Admin-only commands below this point

  listUsers() {
    if (!isAdmin(this)) {
      return;
    }
    const channels = {};
    server.clients.filter(client => client.channel).forEach((client) => {
      if (!channels[client.channel]) {
        channels[client.channel] = [];
      }
      channels[client.channel].push(client.nick);
    });

    const lines = [];
    Object.keys(channels).forEach((channel) => {
      lines.push(`?${channel} ${channels[channel].join(', ')}`);
    });
    let text = `${server.clients.length} users online:\n\n`;
    text += lines.join('\n');
    send({ cmd: 'info', text }, this);
  },

  broadcast(args) {
    if (!isAdmin(this)) {
      return;
    }
    const text = String(args.text);
    broadcast({ cmd: 'info', text: `Server broadcast: ${text}` });
  },
};

server.on('connection', (socket) => {
  socket.on('message', (data) => {
    try {
      // Don't penalize yet, but check whether IP is rate-limited
      if (POLICE.frisk(getAddress(socket), 0)) {
        send({ cmd: 'warn', text: 'Your IP is being rate-limited or blocked.' }, socket);
        return;
      }
      // Penalize here, but don't do anything about it
      POLICE.frisk(getAddress(socket), 1);

      // ignore ridiculously large packets
      if (data.length > 65536) {
        return;
      }
      const args = JSON.parse(data);
      const cmd = args.cmd;
      const command = COMMANDS[cmd];
      if (command && args) {
        command.call(socket, args);
      }
    } catch (e) {
      console.warn(e.stack);
    }
  });

  socket.on('close', () => {
    try {
      if (socket.channel) {
        broadcast({ cmd: 'onlineRemove', nick: socket.nick }, socket.channel);
      }
    } catch (e) {
      console.warn(e.stack);
    }
  });
});

