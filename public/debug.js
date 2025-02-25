// 添加这个文件到 index.html 中的 script 标签后面
// <script src="debug.js"></script>

// 调试函数
window.debugGame = function() {
  console.log("=== 游戏状态调试 ===");
  console.log("房间ID:", gameState.roomId);
  console.log("玩家ID:", gameState.playerId);
  console.log("颜色:", gameState.isBlack ? "黑方" : "白方");
  console.log("游戏激活:", gameState.gameActive);
  console.log("当前轮次:", gameState.currentPlayerTurn ? "我的回合" : "对方回合");
  console.log("棋盘状态:", gameState.board);

  // 统计棋盘上的黑子和白子
  let blackCount = 0;
  let whiteCount = 0;

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = gameState.board[y][x];
      if (cell) {
        if (cell.isBlack) {
          blackCount++;
        } else {
          whiteCount++;
        }
      }
    }
  }

  console.log("黑子数量:", blackCount);
  console.log("白子数量:", whiteCount);
}

// 在控制台中添加说明
console.log("调试工具已加载。输入 debugGame() 查看当前游戏状态。");

// 添加调试按钮到页面
const debugBtn = document.createElement('button');
debugBtn.textContent = '调试';
debugBtn.style.position = 'fixed';
debugBtn.style.bottom = '10px';
debugBtn.style.right = '10px';
debugBtn.style.zIndex = '1000';
debugBtn.addEventListener('click', window.debugGame);
document.body.appendChild(debugBtn);

// WebSocket消息拦截
const originalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
  const socket = new originalWebSocket(url, protocols);

  const originalSend = socket.send;
  socket.send = function(data) {
    console.log("WS 发送 >>", JSON.parse(data));
    return originalSend.call(this, data);
  };

  socket.addEventListener('message', function(event) {
    try {
      console.log("WS 接收 <<", JSON.parse(event.data));
    } catch (e) {
      console.log("WS 接收 << (非JSON数据)", event.data);
    }
  });

  return socket;
};
