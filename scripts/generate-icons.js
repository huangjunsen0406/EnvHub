#!/usr/bin/env node
/* eslint-disable */

/**
 * 图标生成脚本
 * 从 resources/icon.png 生成各平台所需的图标格式
 *
 * 需要安装依赖：
 * pnpm add -D sharp
 */

const fs = require('fs').promises
const path = require('path')
const { exec } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(exec)

// 项目根目录
const projectRoot = path.join(__dirname, '..')

// 源图标和目标目录
const sourceIcon = path.join(projectRoot, 'resources', 'icon.png')
const buildDir = path.join(projectRoot, 'build')

// 各平台所需的图标尺寸
const iconSizes = {
  mac: [16, 32, 64, 128, 256, 512, 1024],
  win: [16, 24, 32, 48, 64, 128, 256],
  linux: [16, 24, 32, 48, 64, 128, 256, 512, 1024]
}

async function checkDependencies() {
  try {
    require('sharp')
  } catch (error) {
    console.error('❌ 请先安装依赖：pnpm add -D sharp')
    process.exit(1)
  }
}

async function createRoundedCorners(size, cornerRadius = null) {
  // 如果没有指定圆角半径，使用 size 的 22.5%（类似 iOS 图标）
  const radius = cornerRadius || Math.floor(size * 0.225)

  const roundedCorners = Buffer.from(
    `<svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>`
  )

  return roundedCorners
}

async function generatePNGs() {
  const sharp = require('sharp')
  console.log('📐 生成不同尺寸的 PNG 图标（带圆角）...')

  // 确保 build 目录存在
  await fs.mkdir(buildDir, { recursive: true })

  // 生成所有需要的尺寸
  const allSizes = new Set([...iconSizes.mac, ...iconSizes.win, ...iconSizes.linux])

  for (const size of allSizes) {
    const outputPath = path.join(buildDir, `icon_${size}x${size}.png`)

    // 创建圆角蒙版
    const roundedCorners = await createRoundedCorners(size)

    // 处理图标：调整大小并应用圆角
    await sharp(sourceIcon)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .composite([
        {
          input: roundedCorners,
          blend: 'dest-in'
        }
      ])
      .png()
      .toFile(outputPath)
    console.log(`  ✅ 生成 ${size}x${size}.png (圆角)`)
  }

  // 生成主图标（512x512 带圆角）
  const mainSize = 512
  const mainRoundedCorners = await createRoundedCorners(mainSize)

  await sharp(sourceIcon)
    .resize(mainSize, mainSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .composite([
      {
        input: mainRoundedCorners,
        blend: 'dest-in'
      }
    ])
    .png()
    .toFile(path.join(buildDir, 'icon.png'))
  console.log('  ✅ 生成 icon.png (512x512, 圆角)')
}

async function generateICNS() {
  console.log('🍎 生成 macOS 图标 (ICNS)...')

  const tempDir = path.join(buildDir, 'icon.iconset')
  await fs.mkdir(tempDir, { recursive: true })

  // macOS iconset 需要特定的文件名
  const iconsetFiles = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' }
  ]

  // 复制文件到 iconset
  for (const { size, name } of iconsetFiles) {
    const sourcePath = path.join(buildDir, `icon_${size}x${size}.png`)
    const destPath = path.join(tempDir, name)
    await fs.copyFile(sourcePath, destPath)
  }

  // 使用 iconutil 生成 ICNS (仅在 macOS 上可用)
  if (process.platform === 'darwin') {
    try {
      await execAsync(`iconutil -c icns "${tempDir}" -o "${path.join(buildDir, 'icon.icns')}"`)
      console.log('  ✅ 生成 icon.icns')
    } catch (error) {
      console.log('  ⚠️  iconutil 命令失败，跳过 ICNS 生成')
      console.error(error.message)
    }
  } else {
    console.log('  ⚠️  跳过 ICNS 生成（需要在 macOS 上运行）')
  }

  // 清理临时目录
  await fs.rm(tempDir, { recursive: true, force: true })
}

async function generateICO() {
  console.log('🪟 生成 Windows 图标 (ICO)...')

  try {
    // 尝试使用 png-to-ico 包
    try {
      // 使用动态 import 导入 ES 模块
      const { default: pngToIco } = await import('png-to-ico')

      // 使用多个尺寸生成 ICO
      const sizes = [16, 24, 32, 48, 64, 128, 256]
      const buffers = await Promise.all(
        sizes.map((size) => fs.readFile(path.join(buildDir, `icon_${size}x${size}.png`)))
      )

      const icoBuffer = await pngToIco(buffers)
      await fs.writeFile(path.join(buildDir, 'icon.ico'), icoBuffer)
      console.log('  ✅ 生成 icon.ico (多尺寸)')
    } catch (e) {
      // 如果没有安装 png-to-ico，使用 sharp 生成 256x256 的 PNG
      console.log('  ⚠️  png-to-ico 错误:', e.message)
      const sharp = require('sharp')
      const roundedCorners = await createRoundedCorners(256)

      await sharp(sourceIcon)
        .resize(256, 256, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .composite([
          {
            input: roundedCorners,
            blend: 'dest-in'
          }
        ])
        .png()
        .toFile(path.join(buildDir, 'icon.ico'))
      console.log('  ⚠️  生成 icon.ico (PNG 格式，建议安装 png-to-ico 生成真正的 ICO)')
      console.log('     运行: pnpm add -D png-to-ico')
    }
  } catch (error) {
    console.error('  ❌ ICO 生成失败:', error.message)
  }
}

async function cleanupTempFiles() {
  console.log('🧹 清理临时文件...')

  const tempFiles = await fs.readdir(buildDir)
  for (const file of tempFiles) {
    if (file.startsWith('icon_') && file.endsWith('.png')) {
      await fs.unlink(path.join(buildDir, file))
    }
  }
  console.log('  ✅ 清理完成')
}

async function main() {
  console.log('🎨 开始生成应用图标...\n')

  try {
    // 检查依赖
    await checkDependencies()

    // 检查源文件
    await fs.access(sourceIcon)
    console.log(`📁 源图标: ${sourceIcon}\n`)

    // 生成各种格式
    await generatePNGs()
    console.log('')

    await generateICNS()
    console.log('')

    await generateICO()
    console.log('')

    // 清理临时文件
    await cleanupTempFiles()

    console.log('\n✨ 图标生成完成！')
    console.log('📁 输出目录:', buildDir)
    console.log('\n生成的文件:')
    console.log('  - icon.png (512x512) - 通用图标（圆角）')
    if (process.platform === 'darwin') {
      console.log('  - icon.icns - macOS 图标（圆角）')
    }
    console.log('  - icon.ico - Windows 图标（圆角）')

    console.log('\n提示：')
    console.log('  - 所有图标都已应用圆角效果（22.5% 圆角半径）')
    console.log('  - 生成的图标会被 electron-builder 自动使用')
  } catch (error) {
    console.error('\n❌ 错误:', error)
    process.exit(1)
  }
}

// 运行脚本
main()
