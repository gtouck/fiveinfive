import { Game, type GameRoom, GameState, type Position } from './game.ts';
import * as path from 'path';

// 房间管理
const rooms = new Map<string, GameRoom>();
// 保存WebSocket连接和玩家数据的映射
const wsPlayerMap = new Map<WebSocket, { roomId: string; playerId: string }>();

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

// 向房间所有玩家广播消息
function broadcastToRoom(room: GameRoom, message: any) {
  const messageStr = JSON.stringify(message);
  room.players.forEach((player) => {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
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

// 处理WebSocket消息
async function handleWebSocketMessage(ws: WebSocket, message: string) {
  try {
    const data: WebSocketMessage = JSON.parse(message);
    const wsData = wsPlayerMap.get(ws);
    if (!wsData) return;

    const { roomId, playerId } = wsData;
    const room = getOrCreateRoom(roomId);
    const player = room.players.find((p) => p.id === playerId);

    if (!player) return;

    switch (data.type) {
      case 'move':
        if (room.players.length !== 2) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: '需要两名玩家才能开始游戏',
            })
          );
          return;
        }

        if (data.position) {
          // 修复游戏开始时的回合判定逻辑
          let isPlayerTurn = false;

          if (room.game.currentPlayer === null) {
            // 游戏刚开始，黑方先行
            isPlayerTurn = player.isBlack;
            // 设置当前玩家为当前尝试下棋的玩家
            room.game.currentPlayer = player;
          } else {
            // 已经有人下过棋了，检查是否轮到当前玩家
            isPlayerTurn = room.game.currentPlayer.id === player.id;
          }

          // 调试日志
          console.log(
            `Player ${player.id} (${
              player.isBlack ? 'BLACK' : 'WHITE'
            }) attempting move. Current turn: ${isPlayerTurn ? 'YES' : 'NO'}`
          );

          if (!isPlayerTurn) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: '现在不是你的回合',
              })
            );
            return;
          }

          if (room.game.makeMove(player, data.position)) {
            // 移动成功，切换到对手回合
            const nextPlayer = room.players.find((p) => p.id !== player.id);
            if (nextPlayer && room.game.state === GameState.PLAYING) {
              room.game.currentPlayer = nextPlayer;
              console.log(
                `Turn switched to player ${nextPlayer.id} (${
                  nextPlayer.isBlack ? 'BLACK' : 'WHITE'
                })`
              );
            } else if (room.game.state !== GameState.PLAYING) {
              // 游戏结束，清除当前玩家
              room.game.currentPlayer = null;
              console.log('Game ended, current player cleared');
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
            ws.send(
              JSON.stringify({
                type: 'error',
                message: '无效的移动',
              })
            );
          }
        }
        break;

      case 'restart':
        if (room.game.state !== GameState.PLAYING) {
          // 交换颜色
          room.players.forEach((p) => (p.isBlack = !p.isBlack));

          // 创建新游戏
          room.game = new Game();

          // 重要！确保游戏状态为PLAYING并设置黑方为当前玩家
          room.game.state = GameState.PLAYING;
          room.game.currentPlayer = room.players.find((p) => p.isBlack) || null;

          console.log(
            'Game restarted. Current player:',
            room.game.currentPlayer
              ? `${room.game.currentPlayer.id} (${
                  room.game.currentPlayer.isBlack ? 'BLACK' : 'WHITE'
                })`
              : 'None'
          );

          // 广播游戏重新开始
          broadcastToRoom(room, {
            type: 'gameRestart',
            board: room.game.board,
            players: room.players.map((p) => ({
              id: p.id,
              isBlack: p.isBlack,
            })),
            currentPlayer: room.game.currentPlayer?.id,
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
}

// 处理HTTP请求
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 处理WebSocket连接
  if (req.headers.get('upgrade') === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const roomId = url.searchParams.get('room') || generateRoomId();
    const playerId = Math.random().toString(36).substring(2, 10);

    // 保存WebSocket和玩家数据的映射
    wsPlayerMap.set(socket, { roomId, playerId });

    socket.onopen = () => {
      const room = getOrCreateRoom(roomId);

      // 如果房间已满，拒绝连接
      if (
        room.players.length >= 2 &&
        !room.players.some((p) => p.id === playerId)
      ) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: '房间已满',
          })
        );
        socket.close();
        return;
      }

      // 查找现有玩家或添加新玩家
      let player = room.players.find((p) => p.id === playerId);
      if (!player) {
        const isFirstPlayer = room.players.length === 0;
        player = {
          id: playerId,
          ws: socket,
          isBlack: isFirstPlayer
            ? Math.random() > 0.5
            : !room.players[0].isBlack,
        };
        room.players.push(player);
      } else {
        // 更新现有玩家的WebSocket连接
        player.ws = socket;
      }

      // 向玩家发送房间信息
      socket.send(
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
    };

    socket.onmessage = (event) => {
      handleWebSocketMessage(socket, event.data);
    };

    socket.onclose = () => {
      const wsData = wsPlayerMap.get(socket);
      if (!wsData) return;

      const { roomId, playerId } = wsData;
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

      // 删除WebSocket映射
      wsPlayerMap.delete(socket);
    };

    return response;
  }

  // 提供静态文件
  const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const publicPath = path.join(Deno.cwd(), 'public', filePath);

  try {
    const file = await Deno.readFile(publicPath);
    const contentType = getContentType(filePath);
    return new Response(file, {
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (e) {
    // 如果文件不存在，返回首页
    try {
      const indexFile = await Deno.readFile(
        path.join(Deno.cwd(), 'public', 'index.html')
      );
      return new Response(indexFile, {
        headers: {
          'Content-Type': 'text/html',
        },
      });
    } catch (e) {
      return new Response('File not found', { status: 404 });
    }
  }
}

// 获取内容类型
function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const contentTypeMap: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };

  return contentTypeMap[ext] || 'application/octet-stream';
}

// 启动服务器
const port = 8000; // 可以选择一个合适的端口号
console.log(`服务器启动在 http://0.0.0.0:${port}`);
Deno.serve({ port: port, hostname: "0.0.0.0" }, handleRequest);
