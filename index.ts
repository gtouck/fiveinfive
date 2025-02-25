import { type ServerWebSocket } from 'bun';
import { type staticPlugin } from 'bun';
import { Game, type GameRoom, Player, GameState, type Position } from './game';
import * as fs from 'fs';
import * as path from 'path';

// 房间管理
const rooms = new Map<string, GameRoom>();

// 生成随机房间ID
function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8);
}

// 获取或创建房间
function getOrCreateRoom(roomId: string): GameRoom {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: [],
      game: new Game(),
      history: [],
    });
  }
  return rooms.get(roomId)!;
}

// WebSocket消息类型
type WebSocketMessage = {
  type: string;
  roomId?: string;
  position?: Position;
  message?: string;
};

// WebSocket连接数据
type WebSocketData = {
  roomId: string;
  playerId: string;
};

// 创建服务器
const server = Bun.serve({
  port: 3000,
  async fetch(req, server) {
    const url = new URL(req.url);

    // 处理WebSocket连接
    if (
      server.upgrade(req, {
        data: {
          roomId: url.searchParams.get('room') || generateRoomId(),
          playerId: Math.random().toString(36).substring(2, 10),
        },
      })
    ) {
      return; // 已升级为WebSocket连接
    }

    // 提供静态文件
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const publicPath = path.join(import.meta.dir, 'public', filePath);

    try {
      const file = Bun.file(publicPath);
      const exists = await file.exists();
      if (exists) {
        return new Response(file);
      }
    } catch (e) {
      // 文件不存在或其他错误，继续处理
    }

    // 默认返回首页
    return new Response(
      Bun.file(path.join(import.meta.dir, 'public', 'index.html'))
    );
  },
  websocket: {
    open(ws: ServerWebSocket<WebSocketData>) {
      const { roomId, playerId } = ws.data;
      const room = getOrCreateRoom(roomId);

      // 如果房间已满，拒绝连接
      if (
        room.players.length >= 2 &&
        !room.players.some((p) => p.id === playerId)
      ) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: '房间已满',
          })
        );
        ws.close();
        return;
      }

      // 查找现有玩家或添加新玩家
      let player = room.players.find((p) => p.id === playerId);
      if (!player) {
        const isFirstPlayer = room.players.length === 0;
        player = {
          id: playerId,
          ws,
          isBlack: isFirstPlayer
            ? Math.random() > 0.5
            : !room.players[0].isBlack,
        };
        room.players.push(player);
      } else {
        // 更新现有玩家的WebSocket连接
        player.ws = ws;
      }

      // 向玩家发送房间信息
      ws.send(
        JSON.stringify({
          type: 'roomInfo',
          roomId,
          playerId,
          isBlack: player.isBlack,
          canStart: room.players.length === 2,
          history: room.history,
          gameState: room.game.state,
        })
      );

      // 广播房间状态更新
      broadcastRoomUpdate(room);
    },
    message(ws: ServerWebSocket<WebSocketData>, message: string) {
      try {
        const data: WebSocketMessage = JSON.parse(message);
        const { roomId, playerId } = ws.data;
        const room = getOrCreateRoom(roomId);
        const player = room.players.find((p) => p.id === playerId);

        if (!player) return;

        switch (data.type) {
          case 'move':
            if (room.players.length !== 2) {
              ws.send(JSON.stringify({
                type: 'error',
                message: '需要两名玩家才能开始游戏'
              }));
              return;
            }

            if (data.position) {
              // 判断是否是玩家的回合
              const isPlayerTurn = room.game.currentPlayer === null ?
                (player.isBlack && room.game.state === GameState.WAITING) :
                room.game.currentPlayer.id === player.id;

              if (!isPlayerTurn) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: '现在不是你的回合'
                }));
                return;
              }

              if (room.game.makeMove(player, data.position)) {
                // 确定下一个玩家 - 如果当前玩家下完后游戏状态没变，说明游戏继续
                if (room.game.state === GameState.PLAYING && room.game.currentPlayer === null) {
                  // 找到另一个玩家
                  const nextPlayer = room.players.find(p => p.id !== player.id);
                  if (nextPlayer) {
                    room.game.currentPlayer = nextPlayer;
                  }
                }

                // 广播移动信息
                broadcastToRoom(room, {
                  type: 'gameUpdate',
                  board: room.game.board,
                  currentPlayer: room.game.currentPlayer?.id,
                  gameState: room.game.state,
                  lastMove: data.position,
                  winnerColor: room.game.winner?.isBlack ? 'black' : 'white',
                });

                // 如果游戏结束，记录历史
                if (room.game.state !== GameState.PLAYING) {
                  room.history.push({
                    winner: room.game.winner?.isBlack ? '黑方' : '白方',
                    timestamp: new Date().toISOString(),
                  });
                }
              } else {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: '无效的移动'
                }));
              }
            }
            break;

          case 'restart':
            if (room.game.state !== GameState.PLAYING) {
              // 交换颜色
              room.players.forEach((p) => (p.isBlack = !p.isBlack));
              room.game = new Game();
              room.game.state = GameState.PLAYING;

              // 广播游戏重新开始
              broadcastToRoom(room, {
                type: 'gameRestart',
                board: room.game.board,
                players: room.players.map((p) => ({
                  id: p.id,
                  isBlack: p.isBlack,
                })),
                history: room.history,
              });
            }
            break;

          case 'chat':
            if (data.message) {
              broadcastToRoom(room, {
                type: 'chat',
                sender: player.id,
                message: data.message,
              });
            }
            break;
        }
      } catch (error) {
        console.error('WebSocket消息处理错误:', error);
      }
    },
    close(ws: ServerWebSocket<WebSocketData>) {
      const { roomId, playerId } = ws.data;
      const room = rooms.get(roomId);

      if (room) {
        // 移除玩家
        room.players = room.players.filter((p) => p.id !== playerId);

        // 如果房间为空，删除房间
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // 通知房间中的其他玩家
          broadcastToRoom(room, {
            type: 'playerLeft',
            playerId,
          });
        }
      }
    },
  },
});
console.log('服务器已启动, 访问 http://localhost:3000');

// 向房间所有玩家广播消息
function broadcastToRoom(room: GameRoom, message: any) {
  const messageStr = JSON.stringify(message);
  room.players.forEach((player) => {
    if (player.ws && player.ws.readyState === 1) {
      player.ws.send(messageStr);
    }
  });
}

// 广播房间状态更新
function broadcastRoomUpdate(room: GameRoom) {
  broadcastToRoom(room, {
    type: 'roomUpdate',
    playerCount: room.players.length,
    canStart: room.players.length === 2,
    gameState: room.game.state,
  });
}
