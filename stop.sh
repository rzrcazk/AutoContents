#!/bin/bash

# MakeContents 本地开发停止脚本

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================="
echo "  MakeContents 停止服务"
echo "=============================="

# 停止占用端口 3710 的进程（后端）
echo "停止后端服务 (端口 3710)..."
if lsof -ti:3710 > /dev/null 2>&1; then
  lsof -ti:3710 | xargs kill -TERM 2>/dev/null
  sleep 1
  # 强制终止如果还在运行
  lsof -ti:3710 | xargs kill -KILL 2>/dev/null
  echo "✓ 后端服务已停止"
else
  echo "  端口 3710 未占用"
fi

# 停止占用端口 3711 的进程（前端）
echo "停止前端服务 (端口 3711)..."
if lsof -ti:3711 > /dev/null 2>&1; then
  lsof -ti:3711 | xargs kill -TERM 2>/dev/null
  sleep 1
  # 强制终止如果还在运行
  lsof -ti:3711 | xargs kill -KILL 2>/dev/null
  echo "✓ 前端服务已停止"
else
  echo "  端口 3711 未占用"
fi

echo "=============================="
echo "  服务已停止"
echo "=============================="
