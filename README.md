# luci-app-device-curfew

局域网设备网络宵禁与家长管控 LuCI 应用（适用于使用 firewall4 (nftables) 的 OpenWrt 22.03 及以上版本）。

## 功能特性

- **网络宵禁与定时断网**：按 MAC 地址阻断指定设备的网络访问，支持自定义星期与时段，完美支持跨午夜时段（例如 20:20 至次日 06:00）。
- **零中断与高性能**：通过原子修改 nftables set 动态生效，无需全量重载防火墙，完全不影响局域网其他设备的正常通信。
- **免疫透明代理绕过**：阻断链挂载在 `prerouting` 且优先级为 `raw` (-300)，先于常见透明代理（OpenClash / Nikki / Clash.Meta）的 TProxy / REDIRECT 链处理，杜绝代理旁路失效。
- **底层网络协议放行**：阻断期间白名单放行 DHCPv4、DHCPv6 和 ICMPv6 邻居发现（NDP）报文，设备保持正常的局域网 IP 租约与 Wi-Fi 连通状态，不会出现因断网而频繁掉线提示。
- **一键临时放行**：支持下拉选择临时放行 15 分钟、30 分钟、1 小时、2 小时或自定义分钟数，到期后自动恢复按规则管控。
- **掉电与防火墙重载自愈**：路由器开机、重启以及防火墙规则重载后，自动根据当前时刻恢复应有的阻断状态。

## 目录结构

```text
luci-app-device-curfew/
├── Makefile
├── htdocs/luci-static/resources/view/device_curfew/
│   └── overview.js                               # LuCI SPA 界面
└── root/
    ├── etc/
    │   ├── config/device_curfew                  # UCI 配置文件
    │   ├── init.d/device_curfew                  # procd 守护服务
    │   ├── nftables.d/30-device-curfew.nft       # nftables 规则与 set
    │   └── uci-defaults/luci-app-device-curfew   # 安装自启动初始化脚本
    └── usr/
        ├── bin/device_curfew_ctl                 # 核心控制脚本 (CLI)
        └── share/
            ├── device_curfew/firewall.include    # fw4 重载事件监听
            ├── luci/menu.d/luci-app-device-curfew.json
            └── rpcd/acl.d/luci-app-device-curfew.json
```

## 安装部署

### 1. 从 Releases 下载安装包（推荐）

前往 **[Releases 最新发布页](https://github.com/fishyo/luci-app-device-curfew/releases)** 获取预构建安装包：

- **OpenWrt 25.x / 24.10 固件（使用 apk）**：
  下载 `luci-app-device-curfew-1.0.0-r1.apk` 并执行：
  ```sh
  apk add --allow-untrusted luci-app-device-curfew-1.0.0-r1.apk
  ```
- **OpenWrt 21.02 ~ 23.05 固件（使用 opkg）**：
  下载 `luci-app-device-curfew_1.0.0-1_all.ipk`，在 LuCI 后台的 **系统 -> 软件包 -> 上传软件包** 安装，或执行：
  ```sh
  opkg install luci-app-device-curfew_1.0.0-1_all.ipk
  ```
- **全平台通用便携安装**：
  下载 `luci-app-device-curfew_1.0.0-1_portable.tar.gz` 并执行：
  ```sh
  tar -zxvf luci-app-device-curfew_1.0.0-1_portable.tar.gz -C /
  chmod +x /usr/bin/device_curfew_ctl /etc/init.d/device_curfew /usr/share/device_curfew/firewall.include
  sh /etc/uci-defaults/luci-app-device-curfew
  ```

### 2. 手动部署至路由器

```sh
scp -r root/* root@<ROUTER_IP>:/
scp -r htdocs/* root@<ROUTER_IP>:/www/

ssh root@<ROUTER_IP> "
chmod +x /usr/bin/device_curfew_ctl /etc/init.d/device_curfew /usr/share/device_curfew/firewall.include
sh /etc/uci-defaults/luci-app-device-curfew
"
```

> [!NOTE]
> 脚本必须保持 LF 换行（仓库已通过 `.gitattributes` 自动规范）。

安装完成后，在 OpenWrt 管理界面的 **【服务】 -> 【设备网络宵禁】** 菜单即可进入。

### OpenWrt SDK 单包编译

```sh
git clone https://github.com/fishyo/luci-app-device-curfew.git package/luci-app-device-curfew
make menuconfig    # 进入 LuCI > Applications > 选中 luci-app-device-curfew
make package/luci-app-device-curfew/compile V=s
```

## 命令行调试 (CLI)

```sh
device_curfew_ctl status                              # 输出当前状态 (JSON 格式)
device_curfew_ctl sync                                # 立即按当前时间和规则同步阻断集合
device_curfew_ctl temp_pass 00:11:22:33:44:55 30      # 临时放行该设备 30 分钟
device_curfew_ctl clear_temp_pass 00:11:22:33:44:55   # 立即提前取消临时放行
device_curfew_ctl block 00:11:22:33:44:55             # 手动将设备加入阻断
device_curfew_ctl unblock 00:11:22:33:44:55           # 手动将设备解除阻断
```

## 共创与致谢 (Credits)

本项目由 **[fishyo](https://github.com/fishyo)** 与 **Google Gemini** 结对共创完成：
- **fishyo**：产品构想、功能定义、OpenWrt 路由器硬件实机部署与真机调试。
- **Google Gemini**：底层控制算法实现、nftables 原始链防火墙设计、LuCI JS SPA 单页应用及代码工程重构。

## 许可证

[Apache License 2.0](LICENSE)
