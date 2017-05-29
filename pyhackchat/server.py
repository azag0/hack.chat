#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
import json
from collections import defaultdict
import sqlite3
import websockets
import time

from typing import DefaultDict, Set, Any, Optional, Iterator, Tuple  # noqa
WebSocket = websockets.WebSocketServerProtocol

with open('config.json') as f:
    cfg = json.load(f)

db = sqlite3.connect('messages.db', check_same_thread=False)
db.execute(
    'create table if not exists msgs '
    '(time integer primary key, channel text, nick text, msg text)'
)


class Client:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.nick: Optional[str] = None
        self.channel: Optional[str] = None

    async def send(self, obj: Any) -> None:
        s = json.dumps(obj)
        await self.ws.send(s)

    async def recv(self) -> Any:
        data = await self.ws.recv()
        return json.loads(data)

    cmds = 'join chat'.split()

    async def join(self, channel: str, nick: str, **kwargs: Any) -> None:
        rooms[channel].add(self)
        self.nick = nick
        self.channel = channel
        for ttime, nick, text in get_messages(channel):
            await self.send({
                'cmd': 'chat',
                'time': ttime,
                'nick': nick,
                'text': text
            })
        await broadcast({'cmd': 'onlineAdd', 'nick': nick}, channel)
        await self.send({
            'cmd': 'onlineSet',
            'nicks': [cl.nick for cl in rooms[channel]]
        })

    async def chat(self, text: str, **kwargs: Any) -> None:
        if not self.channel or not self.nick:
            return
        now = get_now()
        await broadcast({
            'cmd': 'chat',
            'time': now,
            'nick': self.nick,
            'text': text
        }, self.channel)
        log_message(now, self.channel, self.nick, text)


rooms: DefaultDict[str, Set[Client]] = defaultdict(set)


def get_now() -> int:
    return int(1000*time.time())


async def broadcast(obj: Any, channel: str) -> None:
    for client in rooms[channel]:
        await client.send(obj)


def get_messages(channel: str) -> Iterator[Tuple[int, str, str]]:
    yield from db.execute(
        f'select time, nick, msg from msgs where channel = "{channel}" order by time'
    )


def log_message(now: int, channel: str, nick: str, text: str) -> None:
    db.execute('insert into msgs values (?,?,?,?)', (now, channel, nick, text))
    db.commit()


async def handler(ws: WebSocket, path: str) -> None:
    client = Client(ws)
    try:
        while True:
            args = await client.recv()
            if args['cmd'] in client.cmds:
                await getattr(client, args['cmd'])(**args)
    except websockets.ConnectionClosed as e:
        if not client.channel:
            return
        rooms[client.channel].remove(client)
        await broadcast({
            'cmd': 'onlineRemove',
            'nick': client.nick
        }, client.channel)


if __name__ == '__main__':
    import uvloop

    coro = websockets.serve(handler, cfg['host'], cfg['port'])
    loop = uvloop.new_event_loop()
    loop.create_task(coro)
    loop.run_forever()
