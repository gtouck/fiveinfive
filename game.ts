import {type ServerWebSocket } from "bun";

// 棋盘大小
export const BOARD_SIZE = 15;

// 位置接口
export interface Position {
  x: number;
  y: number;
}

// 游戏状态枚举
export enum GameState {
  WAITING = "waiting",
  PLAYING = "playing",
  BLACK_WIN = "black_win",
  WHITE_WIN = "white_win",
  DRAW = "draw"
}

// 玩家接口
export interface Player {
  id: string;
  ws: ServerWebSocket<any>;
  isBlack: boolean;
}

// 游戏历史记录条目
export interface GameHistoryEntry {
  winner: string;
  timestamp: string;
}

// 房间接口
export interface GameRoom {
  id: string;
  players: Player[];
  game: Game;
  history: GameHistoryEntry[];
}

// 游戏类
export class Game {
  board: (Player | null)[][];
  state: GameState;
  currentPlayer: Player | null;
  winner: Player | null;

  constructor() {
    // 初始化棋盘
    this.board = Array(BOARD_SIZE).fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));
    this.state = GameState.WAITING;
    this.currentPlayer = null;
    this.winner = null;
  }

  // 判断是否可以移动
  canMove(player: Player, position: Position): boolean {
    // 检查游戏是否正在进行
    if (this.state !== GameState.PLAYING && this.state !== GameState.WAITING) {
      return false;
    }

    // 如果游戏处于等待状态且有两名玩家，开始游戏
    if (this.state === GameState.WAITING) {
      this.state = GameState.PLAYING;
      // 黑方先行
      this.currentPlayer = player.isBlack ? player : null;
    }

    // 检查是否轮到该玩家
    if (this.currentPlayer && this.currentPlayer.id !== player.id) {
      return false;
    }

    // 确保位置在棋盘范围内
    if (position.x < 0 || position.x >= BOARD_SIZE ||
        position.y < 0 || position.y >= BOARD_SIZE) {
      return false;
    }

    // 检查位置是否已被占用
    if (this.board[position.y][position.x] !== null) {
      return false;
    }

    return true;
  }

  // 执行移动
  makeMove(player: Player, position: Position): boolean {
    if (!this.canMove(player, position)) {
      return false;
    }

    // 放置棋子
    this.board[position.y][position.x] = player;

    // 检查是否获胜
    if (this.checkWin(position, player)) {
      this.state = player.isBlack ? GameState.BLACK_WIN : GameState.WHITE_WIN;
      this.winner = player;
      return true;
    }

    // 检查是否平局
    if (this.checkDraw()) {
      this.state = GameState.DRAW;
      return true;
    }

    // 简单地把currentPlayer设为null，等待另一个玩家的行动
    // 这样就不需要在这里处理复杂的player引用问题
    this.currentPlayer = null;

    return true;
  }

  // 检查是否平局
  checkDraw(): boolean {
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (this.board[y][x] === null) {
          return false;
        }
      }
    }
    return true;
  }

  // 检查获胜
  checkWin(position: Position, player: Player): boolean {
    const directions = [
      [0, 1],  // 水平
      [1, 0],  // 垂直
      [1, 1],  // 对角线(右下)
      [1, -1]  // 对角线(右上)
    ];

    for (const [dx, dy] of directions) {
      let count = 1; // 当前位置的棋子

      // 正向检查
      for (let i = 1; i < 5; i++) {
        const x = position.x + dx * i;
        const y = position.y + dy * i;

        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
          break;
        }

        if (this.board[y][x]?.id === player.id) {
          count++;
        } else {
          break;
        }
      }

      // 反向检查
      for (let i = 1; i < 5; i++) {
        const x = position.x - dx * i;
        const y = position.y - dy * i;

        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
          break;
        }

        if (this.board[y][x]?.id === player.id) {
          count++;
        } else {
          break;
        }
      }

      // 五子连珠
      if (count >= 5) {
        return true;
      }
    }

    return false;
  }
}
