#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  Tool,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// パスアクセス制限の設定
class PathValidator {
  private allowedPaths: string[];
  private blockedPaths: string[];
  private allowedExtensions: string[];

  constructor() {
    // 許可されるディレクトリ（絶対パスに正規化）
    this.allowedPaths = [
      //path.resolve(process.cwd()), // 現在のワーキングディレクトリ
      //path.resolve(os.homedir(), 'Documents'), // ドキュメントフォルダ
      path.resolve(os.homedir(), 'Documents/00_AI_Area'), // 専用フォルダ
      //path.resolve(os.homedir(), 'Desktop'), // デスクトップ
      //path.resolve(os.tmpdir()), // 一時ディレクトリ
    ];

    // 明示的にブロックするパス
    this.blockedPaths = [
      '/etc',
      '/bin',
      '/sbin',
      '/usr/bin',
      '/usr/sbin',
      '/System',
      '/Windows',
      '/Program Files',
      '/Program Files (x86)',
      path.resolve(os.homedir(), '.ssh'),
      path.resolve(os.homedir(), '.aws'),
      path.resolve(os.homedir(), '.config'),
    ];

    // 許可されるファイル拡張子
    this.allowedExtensions = [
      '.txt', '.md', '.json', '.js', '.ts', '.html', '.css',
      '.py', '.java', '.cpp', '.c', '.h', '.xml', '.yaml', '.yml',
      '.log', '.csv', '.tsv', '.sql', '.sh', '.bat', '.ps1'
    ];
  }

  validatePath(inputPath: string): { isValid: boolean; normalizedPath: string; error?: string } {
    try {
      // パスを正規化
      const normalizedPath = path.resolve(inputPath);
      
      // ブロックされたパスのチェック
      for (const blockedPath of this.blockedPaths) {
        if (normalizedPath.startsWith(path.resolve(blockedPath))) {
          return {
            isValid: false,
            normalizedPath,
            error: `アクセスが禁止されているディレクトリです: ${blockedPath}`
          };
        }
      }

      // 許可されたパスのチェック
      const isAllowed = this.allowedPaths.some(allowedPath => 
        normalizedPath.startsWith(allowedPath)
      );

      if (!isAllowed) {
        return {
          isValid: false,
          normalizedPath,
          error: `許可されていないパスです。アクセス可能なパス: ${this.allowedPaths.join(', ')}`
        };
      }

      return { isValid: true, normalizedPath };
    } catch (error) {
      return {
        isValid: false,
        normalizedPath: inputPath,
        error: `無効なパスです: ${error}`
      };
    }
  }

  validateFileExtension(filepath: string): { isValid: boolean; error?: string } {
    const ext = path.extname(filepath).toLowerCase();
    
    if (ext && !this.allowedExtensions.includes(ext)) {
      return {
        isValid: false,
        error: `許可されていないファイル拡張子です: ${ext}。許可されている拡張子: ${this.allowedExtensions.join(', ')}`
      };
    }

    return { isValid: true };
  }

  getAllowedPaths(): string[] {
    return [...this.allowedPaths];
  }
}

// 利用可能なツールの定義
const TOOLS: Tool[] = [
  {
    name: "read_file",
    description: "指定されたファイルの内容を読み込みます（許可されたディレクトリのみ）",
    inputSchema: {
      type: "object",
      properties: {
        filepath: {
          type: "string",
          description: "読み込むファイルのパス",
        },
      },
      required: ["filepath"],
    },
  },
  {
    name: "write_file",
    description: "指定されたファイルにテキストを書き込みます（許可されたディレクトリのみ）",
    inputSchema: {
      type: "object",
      properties: {
        filepath: {
          type: "string",
          description: "書き込むファイルのパス",
        },
        content: {
          type: "string",
          description: "書き込む内容",
        },
      },
      required: ["filepath", "content"],
    },
  },
  {
    name: "list_directory",
    description: "指定されたディレクトリの内容を一覧表示します（許可されたディレクトリのみ）",
    inputSchema: {
      type: "object",
      properties: {
        dirpath: {
          type: "string",
          description: "一覧表示するディレクトリのパス",
        },
      },
      required: ["dirpath"],
    },
  },
  {
    name: "get_system_info",
    description: "システム情報を取得します",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_sample_file",
    description: "サンプルファイルを作成します（テスト用）",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "作成するファイル名（デフォルト: sample.txt）",
        },
      },
    },
  },
  {
    name: "get_allowed_paths",
    description: "アクセス可能なパスの一覧を表示します",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

class SimpleMCPServer {
  private server: Server;
  private pathValidator: PathValidator;

  constructor() {
    this.pathValidator = new PathValidator();
    this.server = new Server(
      {
        name: "simple-mcp-server",
        version: "1.0.0",
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      console.error("Received SIGINT, closing server...");
      await this.server.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.error("Received SIGTERM, closing server...");
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    console.error("Setting up tool handlers...");

    // Initialize ハンドラー
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      console.error("Initialize request received:", JSON.stringify(request.params));
      return {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "simple-mcp-server",
          version: "1.0.0",
        },
      };
    });

    // ツール一覧の提供
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error("ListTools request received");
      return {
        tools: TOOLS,
      };
    });

    // ツール実行の処理
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error("CallTool request received:", JSON.stringify(request.params));
      const { name, arguments: args } = request.params;

      if (!args) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No arguments provided",
            },
          ],
          isError: true,
        };
      }

      try {
        switch (name) {
          case "read_file":
            return await this.readFile(args.filepath as string);

          case "write_file":
            return await this.writeFile(
              args.filepath as string,
              args.content as string
            );

          case "list_directory":
            return await this.listDirectory(args.dirpath as string);

          case "get_system_info":
            return await this.getSystemInfo();

          case "create_sample_file":
            return await this.createSampleFile(args.filename as string);

          case "get_allowed_paths":
            return await this.getAllowedPaths();

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error("Tool execution error:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async readFile(filepath: string): Promise<CallToolResult> {
    try {
      const pathValidation = this.pathValidator.validatePath(filepath);
      if (!pathValidation.isValid) {
        throw new Error(pathValidation.error);
      }

      const extValidation = this.pathValidator.validateFileExtension(pathValidation.normalizedPath);
      if (!extValidation.isValid) {
        throw new Error(extValidation.error);
      }

      console.error(`Reading file: ${pathValidation.normalizedPath}`);
      const content = await fs.readFile(pathValidation.normalizedPath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `ファイル "${pathValidation.normalizedPath}" の内容:\n\n${content}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw new Error(`ファイルの読み込みに失敗: ${error}`);
    }
  }

  private async writeFile(filepath: string, content: string): Promise<CallToolResult> {
    try {
      const pathValidation = this.pathValidator.validatePath(filepath);
      if (!pathValidation.isValid) {
        throw new Error(pathValidation.error);
      }

      const extValidation = this.pathValidator.validateFileExtension(pathValidation.normalizedPath);
      if (!extValidation.isValid) {
        throw new Error(extValidation.error);
      }

      console.error(`Writing file: ${pathValidation.normalizedPath}`);
      // ディレクトリが存在しない場合は作成
      const dir = path.dirname(pathValidation.normalizedPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(pathValidation.normalizedPath, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `ファイル "${pathValidation.normalizedPath}" に正常に書き込みました`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw new Error(`ファイルの書き込みに失敗: ${error}`);
    }
  }

  private async listDirectory(dirpath: string): Promise<CallToolResult> {
    try {
      const pathValidation = this.pathValidator.validatePath(dirpath);
      if (!pathValidation.isValid) {
        throw new Error(pathValidation.error);
      }

      console.error(`Listing directory: ${pathValidation.normalizedPath}`);
      const items = await fs.readdir(pathValidation.normalizedPath, { withFileTypes: true });
      const fileList = items.map(item => {
        const type = item.isDirectory() ? "📁" : "📄";
        return `${type} ${item.name}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `ディレクトリ "${pathValidation.normalizedPath}" の内容:\n\n${fileList.join("\n")}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw new Error(`ディレクトリの一覧取得に失敗: ${error}`);
    }
  }

  private async getSystemInfo(): Promise<CallToolResult> {
    console.error("Getting system info");
    const info = {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      uptime: `${Math.floor(os.uptime() / 3600)}時間`,
      memory: {
        total: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
        free: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
      },
      cpus: os.cpus().length,
      homeDir: os.homedir(),
      tmpDir: os.tmpdir(),
    };

    return {
      content: [
        {
          type: "text",
          text: `システム情報:\n\n${JSON.stringify(info, null, 2)}`,
        },
      ],
      isError: false,
    };
  }

  private async createSampleFile(filename?: string): Promise<CallToolResult> {
    const sampleFilename = filename || "sample.txt";
    
    try {
      // 現在のワーキングディレクトリにサンプルファイルを作成
      const fullPath = path.resolve(process.cwd(), sampleFilename);
      const pathValidation = this.pathValidator.validatePath(fullPath);
      if (!pathValidation.isValid) {
        throw new Error(pathValidation.error);
      }

      console.error(`Creating sample file: ${pathValidation.normalizedPath}`);

      const sampleContent = `# サンプルファイル

作成日時: ${new Date().toLocaleString("ja-JP")}

これは MCP サーバによって作成されたサンプルファイルです。

## 内容
- MCP (Model Context Protocol) のテスト
- ClaudeDesktop との連携確認
- ファイル操作の動作確認
- セキュリティ制限付きパスアクセス

## システム情報
- Node.js バージョン: ${process.version}
- プラットフォーム: ${os.platform()}
- アーキテクチャ: ${os.arch()}

## セキュリティ設定
- パスアクセス制限: 有効
- 許可されたディレクトリのみアクセス可能

Happy coding! 🚀
`;

      await fs.writeFile(pathValidation.normalizedPath, sampleContent, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `サンプルファイル "${pathValidation.normalizedPath}" を作成しました！\n\n内容:\n${sampleContent}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      throw new Error(`サンプルファイルの作成に失敗: ${error}`);
    }
  }

  private async getAllowedPaths(): Promise<CallToolResult> {
    const allowedPaths = this.pathValidator.getAllowedPaths();
    return {
      content: [
        {
          type: "text",
          text: `アクセス可能なパス一覧:\n\n${allowedPaths.map(p => `📁 ${p}`).join('\n')}\n\n注意: これらのディレクトリとそのサブディレクトリのみアクセス可能です。`,
        },
      ],
      isError: false,
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // デバッグ用のログ出力
    console.error("Simple MCP Server running on stdio");
    console.error("Available tools:", TOOLS.map(t => t.name));
    console.error("Security: Path access restrictions enabled");
    console.error("Allowed paths:", this.pathValidator.getAllowedPaths());
  }
}

// サーバー起動
console.error("Starting MCP Server...");
const server = new SimpleMCPServer();
server.run().catch((error) => {
  console.error("Failed to run server:", error);
  process.exit(1);
});