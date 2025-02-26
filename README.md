# Five in Five - 五子棋游戏

一个简单的五子棋游戏，使用Deno和WebSocket实现。

## 功能

- 在线五子棋对战
- 基于WebSocket的实时通信
- 房间系统支持多场游戏同时进行
- 游戏历史记录
- 聊天功能

## 运行项目

确保已安装Deno，然后运行：

```bash
deno task start
```

或者直接运行：

```bash
deno run --allow-net --allow-read index.ts
```

访问 http://localhost:3000 开始游戏

## 游戏规则

1. 黑棋先行
2. 在15x15的棋盘上，谁先连成五子（横、竖或对角线）即为获胜

## 项目结构

- `index.ts` - 服务器主文件
- `game.ts` - 游戏逻辑
- `public/` - 静态文件（HTML、CSS、客户端JS）
