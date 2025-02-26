const BOARD_SIZE = 15;
const CELL_SIZE = 30;

// 游戏状态
let gameState = {
  board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)),
  roomId: '',
  playerId: '',
  isBlack: false,
  canPlay: false,
  currentPlayerTurn: false,
  gameActive: false,
  history: []
};

// 获取DOM元素
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const gameStatus = document.getElementById('game-status');
const roomIdElem = document.getElementById('room-id');
const playerRoleElem = document.getElementById('player-role');
const restartBtn = document.getElementById('restart-btn');
const shareBtn = document.getElementById('share-btn');
const historyList = document.getElementById('history-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// 获取音效元素
const moveSound = document.getElementById('move-sound');
const winSound = document.getElementById('win-sound');

// 初始化WebSocket连接
function initWebSocket() {
  // 获取URL参数中的房间ID
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');

  // 构建WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}${roomParam ? `?room=${roomParam}` : ''}`;

  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket连接已建立');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (error) {
      console.error('无法解析WebSocket消息:', error);
    }
  };

  socket.onclose = (event) => {
    console.log('WebSocket连接已关闭');
    gameStatus.textContent = '连接已断开，请刷新页面重试';
    gameStatus.style.color = 'red';
  };

  socket.onerror = (error) => {
    console.error('WebSocket错误:', error);
    gameStatus.textContent = '连接错误，请刷新页面重试';
    gameStatus.style.color = 'red';
  };

  return socket;
}

// 处理WebSocket消息
function handleSocketMessage(data) {
  console.log("收到消息:", data);

  switch(data.type) {
    case 'roomInfo':
      gameState.roomId = data.roomId;
      gameState.playerId = data.playerId;
      gameState.isBlack = data.isBlack;
      gameState.history = data.history || [];
      gameState.gameActive = data.canStart;

      roomIdElem.textContent = data.roomId;
      updatePlayerRole();
      updateHistoryList();

      if (data.canStart) {
        gameState.gameActive = true;
        gameState.currentPlayerTurn = data.isBlack; // 黑方先行
        gameStatus.textContent = '游戏开始！' + (data.isBlack ? '你执黑先行' : '你执白后行');
      } else {
        gameStatus.textContent = '等待对手加入...';
      }

      if (data.gameState) {
        // 确保游戏状态同步
        if (data.gameState === 'playing') {
          gameState.currentPlayerTurn = data.currentPlayer === gameState.playerId;
        }
      }
      break;

    case 'roomUpdate':
      if (data.playerCount === 2 && data.canStart && !gameState.gameActive) {
        gameState.gameActive = true;
        gameStatus.textContent = '游戏开始！' + (gameState.isBlack ? '你执黑先行' : '你执白后行');
        gameState.currentPlayerTurn = gameState.isBlack; // 黑方先行
      }
      break;

    case 'gameUpdate':
      // 更新本地游戏状态
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          gameState.board[y][x] = data.board[y][x];
        }
      }

      // 更新当前玩家轮次
      const isMyTurn = data.currentPlayer === gameState.playerId;
      gameState.currentPlayerTurn = isMyTurn;

      console.log("游戏更新:", {
        currentPlayer: data.currentPlayer,
        myId: gameState.playerId,
        isMyTurn: isMyTurn,
        gameState: data.gameState
      });

      drawBoard();

      if (data.lastMove) {
        highlightLastMove(data.lastMove);
        // 播放落子音效
        playMoveSound();
      }

      if (data.gameState !== 'playing') {
        handleGameEnd(data.gameState, data.winnerColor);
      } else {
        gameStatus.textContent = gameState.currentPlayerTurn ? '轮到你下棋' : '等待对手下棋';
      }
      break;

    case 'gameRestart':
      // 清空棋盘
      gameState.board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
      gameState.gameActive = true;

      // 检查我们是否收到正确的玩家信息
      if (data.players && Array.isArray(data.players)) {
        // 找到自己的玩家信息
        const myPlayer = data.players.find(p => p.id === gameState.playerId);
        if (myPlayer) {
          gameState.isBlack = myPlayer.isBlack;

          // 强制设置回合状态 - 黑方总是先行
          gameState.currentPlayerTurn = myPlayer.isBlack;

          console.log("游戏重启 - 我的角色:", {
            playerId: gameState.playerId,
            isBlack: gameState.isBlack,
            currentPlayerTurn: gameState.currentPlayerTurn
          });
        } else {
          console.error("找不到玩家信息");
        }
      } else {
        console.error("玩家数据格式不正确:", data.players);
      }

      if (data.history) {
        gameState.history = data.history;
      }

      updatePlayerRole();
      updateHistoryList();
      drawBoard();

      // 清晰地显示谁的回合
      if (gameState.currentPlayerTurn) {
        gameStatus.textContent = "游戏重新开始！轮到你下棋";
        gameStatus.style.color = "green";
      } else {
        gameStatus.textContent = "游戏重新开始！等待对手下棋";
        gameStatus.style.color = "blue";
      }

      restartBtn.disabled = true;
      break;

    case 'playerLeft':
      gameStatus.textContent = '对手已离开房间，等待新对手加入...';
      gameState.gameActive = false;
      break;

    case 'chat':
      addChatMessage(data.sender, data.message);
      break;

    case 'error':
      alert(data.message);
      break;
  }
}

// 播放落子音效
function playMoveSound() {
  try {
    // 重置音效，确保每次都能播放
    moveSound.currentTime = 0;
    moveSound.play().catch(e => console.log("音效播放失败:", e));
  } catch (err) {
    console.error("播放落子音效失败:", err);
  }
}

// 播放胜利音效
function playWinSound() {
  try {
    winSound.currentTime = 0;
    winSound.play().catch(e => console.log("胜利音效播放失败:", e));
  } catch (err) {
    console.error("播放胜利音效失败:", err);
  }
}

// 绘制棋盘
function drawBoard() {
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 绘制棋盘背景
  ctx.fillStyle = '#e8c083';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 绘制网格线
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;

  // 水平线
  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(CELL_SIZE / 2, CELL_SIZE / 2 + i * CELL_SIZE);
    ctx.lineTo(canvas.width - CELL_SIZE / 2, CELL_SIZE / 2 + i * CELL_SIZE);
    ctx.stroke();
  }

  // 垂直线
  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(CELL_SIZE / 2 + i * CELL_SIZE, CELL_SIZE / 2);
    ctx.lineTo(CELL_SIZE / 2 + i * CELL_SIZE, canvas.height - CELL_SIZE / 2);
    ctx.stroke();
  }

  // 绘制棋子
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = gameState.board[y][x];
      if (cell) {
        drawStone(x, y, cell.isBlack);
      }
    }
  }
}

// 绘制棋子
function drawStone(x, y, isBlack) {
  const xPos = CELL_SIZE / 2 + x * CELL_SIZE;
  const yPos = CELL_SIZE / 2 + y * CELL_SIZE;
  const radius = CELL_SIZE * 0.4;

  ctx.beginPath();
  ctx.arc(xPos, yPos, radius, 0, Math.PI * 2);

  // 绘制棋子渐变
  const gradient = ctx.createRadialGradient(
    xPos - radius / 2, yPos - radius / 2, 0,
    xPos, yPos, radius
  );

  if (isBlack) {
    gradient.addColorStop(0, '#666');
    gradient.addColorStop(1, '#000');
  } else {
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#ddd');
  }

  ctx.fillStyle = gradient;
  ctx.fill();

  // 绘制边缘
  ctx.strokeStyle = isBlack ? '#333' : '#999';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// 高亮最后一步棋
function highlightLastMove(position) {
  const x = position.x;
  const y = position.y;
  const xPos = CELL_SIZE / 2 + x * CELL_SIZE;
  const yPos = CELL_SIZE / 2 + y * CELL_SIZE;

  ctx.beginPath();
  ctx.arc(xPos, yPos, CELL_SIZE * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
  ctx.fill();
}

// 处理游戏结束
function handleGameEnd(state, winnerColor) {
  let message = '';
  let isWin = false;

  switch(state) {
    case 'black_win':
      message = '黑方获胜！';
      isWin = gameState.isBlack;
      break;
    case 'white_win':
      message = '白方获胜！';
      isWin = !gameState.isBlack;
      break;
    case 'draw':
      message = '平局！';
      break;
  }

  gameStatus.textContent = message;
  restartBtn.disabled = false;

  // 如果玩家获胜，播放胜利音效
  if (isWin) {
    playWinSound();
  }
}

// 更新玩家角色显示
function updatePlayerRole() {
  playerRoleElem.textContent = gameState.isBlack ? '黑方' : '白方';
}

// 添加聊天消息
function addChatMessage(senderId, message) {
  const messageElem = document.createElement('div');
  messageElem.className = 'chat-message';
  messageElem.className += senderId === gameState.playerId ? ' self' : ' other';

  const prefix = senderId === gameState.playerId ? '我' : '对手';
  messageElem.textContent = `${prefix}: ${message}`;

  chatMessages.appendChild(messageElem);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 更新历史记录列表
function updateHistoryList() {
  historyList.innerHTML = '';

  if (gameState.history.length === 0) {
    const li = document.createElement('li');
    li.textContent = '暂无对局记录';
    historyList.appendChild(li);
    return;
  }

  gameState.history.forEach((record, index) => {
    const li = document.createElement('li');
    const date = new Date(record.timestamp);
    const timeString = date.toLocaleTimeString();

    // 修正：根据玩家角色和胜利方正确判断谁获胜
    let winnerText;
    if (record.winner === '平局') {
      winnerText = '平局';
    }
    // 玩家是黑方且黑方获胜，或者玩家是白方且白方获胜
    else if ((record.winner === '黑方' && gameState.isBlack) ||
             (record.winner === '白方' && !gameState.isBlack)) {
      winnerText = '你';
    }
    // 对手获胜的情况
    else {
      winnerText = '对手';
    }

    // 显示记录
    if (winnerText === '平局') {
      li.textContent = `第${index + 1}局: 平局 (${timeString})`;
    } else {
      li.textContent = `第${index + 1}局: ${winnerText}获胜 (${timeString})`;
    }

    historyList.appendChild(li);
  });
}

// 计算点击位置对应的棋盘坐标
function getBoardPosition(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const boardX = Math.floor(x / CELL_SIZE);
  const boardY = Math.floor(y / CELL_SIZE);

  if (boardX < 0 || boardX >= BOARD_SIZE || boardY < 0 || boardY >= BOARD_SIZE) {
    return null;
  }

  return { x: boardX, y: boardY };
}

// 初始化
function init() {
  const socket = initWebSocket();
  drawBoard();

  // 点击棋盘事件
  canvas.addEventListener('click', (event) => {
    if (!gameState.gameActive) {
      console.log("游戏未激活");
      return;
    }

    if (!gameState.currentPlayerTurn) {
      // 详细记录当前状态以便调试
      console.log("不是你的回合 - 当前游戏状态:", {
        isBlack: gameState.isBlack,
        currentPlayerTurn: gameState.currentPlayerTurn,
        gameActive: gameState.gameActive,
        board: gameState.board
      });
      return;
    }

    const position = getBoardPosition(event.clientX, event.clientY);
    if (!position) {
      console.log("无效位置");
      return;
    }

    // 检查位置是否已经有棋子
    if (gameState.board[position.y][position.x] !== null) {
      console.log("该位置已有棋子");
      return;
    }

    console.log(`尝试在 (${position.x}, ${position.y}) 下棋`);
    socket.send(JSON.stringify({
      type: 'move',
      position
    }));
  });

  // 重新开始按钮事件
  restartBtn.addEventListener('click', () => {
    socket.send(JSON.stringify({
      type: 'restart'
    }));
  });

  // 发送聊天消息事件
  sendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      sendChatMessage();
    }
  });

  // 分享链接按钮事件
  shareBtn.addEventListener('click', () => {
    const shareUrl = `${window.location.origin}?room=${gameState.roomId}`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl)
        .then(() => {
          alert('房间链接已复制到剪贴板！');
        })
        .catch(err => {
          console.error('复制失败:', err);
          promptForShare(shareUrl);
        });
    } else {
      promptForShare(shareUrl);
    }
  });

  // 发送聊天消息
  function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    socket.send(JSON.stringify({
      type: 'chat',
      message
    }));

    chatInput.value = '';
  }

  // 提示用户手动复制链接
  function promptForShare(url) {
    const tempInput = document.createElement('input');
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();

    try {
      document.execCommand('copy');
      alert('房间链接已复制到剪贴板！');
    } catch (err) {
      alert(`请手动复制此房间链接: ${url}`);
    }

    document.body.removeChild(tempInput);
  }

  // 添加一个检查回合的调试按钮
  const debugBtn = document.createElement('button');
  debugBtn.textContent = '检查游戏状态';
  debugBtn.style.marginTop = '10px';
  document.body.appendChild(debugBtn);

  debugBtn.addEventListener('click', () => {
    console.log("当前游戏状态:", gameState);
    alert(`当前角色: ${gameState.isBlack ? '黑方' : '白方'}\n当前回合: ${gameState.currentPlayerTurn ? '你的回合' : '对手回合'}`);
  });
}

// 页面加载完成后初始化游戏
window.addEventListener('load', init);