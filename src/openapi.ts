/** OpenAPI 3.1 specification for Data Coffee REST API */
export function getOpenApiSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Data Coffee API",
      description:
        "Data Coffee 是荷兰数据群（700人华人数据/AI社区）的社区匹配服务。成员可以注册身份、创建和加入 coffee session（线下/线上聚会）、发送私信和群消息。",
      version: "0.1.0",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "注册时获得的 token（dc_xxx 格式），用于身份验证。",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        Profile: {
          type: "object",
          properties: {
            user_id: { type: "string" },
            nickname: { type: "string" },
            status: { type: "string", enum: ["pending", "active", "frozen"] },
            city: { type: "string", nullable: true },
            company: { type: "string", nullable: true },
            role: { type: "string", nullable: true },
            skills: { type: "array", items: { type: "string" } },
            bio: { type: "string", nullable: true },
            available: { type: "array", items: { type: "string" } },
            languages: { type: "array", items: { type: "string" } },
          },
        },
        CoffeeSummary: {
          type: "object",
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            description: { type: "string", nullable: true },
            creator: { type: "string" },
            city: { type: "string" },
            location: { type: "string", nullable: true },
            scheduled_at: { type: "string", nullable: true, format: "date-time" },
            participants: { type: "integer" },
            max_size: { type: "integer" },
            status: { type: "string", enum: ["open", "full", "confirmed", "completed", "cancelled"] },
            tags: { type: "array", items: { type: "string" } },
            created_at: { type: "string" },
          },
        },
        CoffeeDetail: {
          type: "object",
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            description: { type: "string", nullable: true },
            creator: { type: "string" },
            city: { type: "string" },
            location: { type: "string", nullable: true },
            scheduled_at: { type: "string", nullable: true, format: "date-time" },
            max_size: { type: "integer" },
            status: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            participants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nickname: { type: "string" },
                  city: { type: "string", nullable: true },
                  role: { type: "string", nullable: true },
                  skills: { type: "array", items: { type: "string" } },
                  participant_role: { type: "string", enum: ["creator", "participant"] },
                },
              },
            },
          },
        },
        Message: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["direct", "coffee", "system"] },
            from: { type: "string" },
            content: { type: "string" },
            coffee_id: { type: "string" },
            coffee_topic: { type: "string" },
            reply_to: { type: "string" },
            read: { type: "boolean" },
            created_at: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/profile/register": {
        post: {
          operationId: "profile_register",
          summary: "注册新成员，返回身份验证 token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["nickname", "bio"],
                  properties: {
                    nickname: { type: "string", description: "显示名称" },
                    bio: { type: "string", description: "自我介绍（技能、角色、城市等）" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "注册成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user_id: { type: "string" },
                      token: { type: "string", description: "保存此 token 用于后续认证" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/profile": {
        get: {
          operationId: "profile_get",
          summary: "按用户 ID 或昵称查询成员资料",
          parameters: [
            {
              name: "query",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "用户 ID 或昵称（支持模糊匹配）",
            },
          ],
          responses: {
            "200": {
              description: "返回匹配的用户资料（单个或数组）",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/Profile" },
                      { type: "array", items: { $ref: "#/components/schemas/Profile" } },
                    ],
                  },
                },
              },
            },
          },
        },
        put: {
          operationId: "profile_update",
          summary: "更新自己的资料",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    city: { type: "string", description: "城市（如 Amsterdam, Rotterdam）" },
                    company: { type: "string", description: "公司或组织" },
                    role: { type: "string", description: "职位" },
                    skills: { type: "array", items: { type: "string" }, description: "技能列表" },
                    bio: { type: "string", description: "更新自我介绍" },
                    available: { type: "array", items: { type: "string" }, description: "可用时间段（如 weekday_evening, weekend）" },
                    languages: { type: "array", items: { type: "string" }, description: "语言" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "更新成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/admin/invite-codes": {
        post: {
          operationId: "admin_create_invite_codes",
          summary: "生成邀请码（管理员）",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["count"],
                  properties: {
                    count: { type: "integer", minimum: 1, maximum: 50, description: "生成邀请码数量" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "生成成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      codes: { type: "array", items: { type: "string" } },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/coffee": {
        post: {
          operationId: "coffee_create",
          summary: "创建 coffee session（聚会）",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["topic"],
                  properties: {
                    topic: { type: "string", description: "聚会话题" },
                    description: { type: "string", description: "详细描述" },
                    city: { type: "string", description: "城市（线下）；不填则为线上" },
                    location: { type: "string", description: "具体地点或线上会议链接" },
                    scheduled_at: { type: "string", format: "date-time", description: "计划时间（ISO 8601）" },
                    max_size: { type: "integer", minimum: 0, default: 0, description: "最大参与人数（0=不限）" },
                    tags: { type: "array", items: { type: "string" }, description: "标签" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "创建成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      coffee_id: { type: "string" },
                      topic: { type: "string" },
                      status: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
        get: {
          operationId: "coffee_list",
          summary: "浏览开放的 coffee session",
          parameters: [
            { name: "city", in: "query", schema: { type: "string" }, description: "按城市筛选" },
            { name: "tag", in: "query", schema: { type: "string" }, description: "按标签筛选" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 }, description: "最大返回数" },
          ],
          responses: {
            "200": {
              description: "Coffee 列表",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      coffees: { type: "array", items: { $ref: "#/components/schemas/CoffeeSummary" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/coffee/{id}": {
        get: {
          operationId: "coffee_detail",
          summary: "查看 coffee session 详情（含参与者列表）",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Coffee ID" },
          ],
          responses: {
            "200": {
              description: "Coffee 详情",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CoffeeDetail" } } },
            },
          },
        },
        put: {
          operationId: "coffee_update",
          summary: "更新 coffee session（仅创建者）",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Coffee ID" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    topic: { type: "string" },
                    description: { type: "string" },
                    city: { type: "string" },
                    location: { type: "string" },
                    scheduled_at: { type: "string", format: "date-time" },
                    max_size: { type: "integer", minimum: 0 },
                    tags: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "更新成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      updated_fields: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/coffee/{id}/join": {
        post: {
          operationId: "coffee_join",
          summary: "加入一个开放的 coffee session",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Coffee ID" },
          ],
          responses: {
            "200": {
              description: "加入成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      coffee_id: { type: "string" },
                      topic: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/coffee/{id}/leave": {
        post: {
          operationId: "coffee_leave",
          summary: "退出 coffee session（创建者不能退出）",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Coffee ID" },
          ],
          responses: {
            "200": {
              description: "退出成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/coffee/{id}/complete": {
        post: {
          operationId: "coffee_complete",
          summary: "标记 coffee session 为已完成（仅创建者）",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Coffee ID" },
          ],
          responses: {
            "200": {
              description: "标记成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/message": {
        post: {
          operationId: "message_send",
          summary: "发送私信（按昵称）或 coffee 群消息",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["content"],
                  properties: {
                    to: { type: "string", description: "收件人昵称（私信）" },
                    coffee_id: { type: "string", description: "Coffee ID（群消息）" },
                    content: { type: "string", description: "消息内容" },
                    reply_to: { type: "string", description: "回复的消息 ID" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "发送成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message_id: { type: "string" },
                      type: { type: "string", enum: ["direct", "coffee"] },
                      to: { type: "string" },
                      coffee_id: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/message/inbox": {
        get: {
          operationId: "message_inbox",
          summary: "查看收件箱（私信、群消息、系统通知）",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "type", in: "query", schema: { type: "string", enum: ["direct", "coffee", "system", "all"], default: "all" }, description: "消息类型筛选" },
            { name: "unread", in: "query", schema: { type: "boolean", default: false }, description: "仅未读" },
            { name: "coffee_id", in: "query", schema: { type: "string" }, description: "指定 coffee 的消息" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 }, description: "最大返回数" },
          ],
          responses: {
            "200": {
              description: "收件箱消息",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      messages: { type: "array", items: { $ref: "#/components/schemas/Message" } },
                      total: { type: "integer" },
                      unread_count: { type: "integer" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/message/read": {
        post: {
          operationId: "message_read",
          summary: "标记消息为已读",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message_id: { type: "string", description: "标记单条消息已读" },
                    coffee_id: { type: "string", description: "标记某 coffee 全部消息已读" },
                    all: { type: "boolean", description: "标记所有未读消息为已读" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "标记成功",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      marked_count: { type: "integer" },
                    },
                  },
                },
              },
            },
            "401": { description: "未认证", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
    },
  };
}
