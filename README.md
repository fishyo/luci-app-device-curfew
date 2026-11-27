# luci-app-device-curfew

适用于 OpenWrt 22.03+（`firewall4` / `nftables`）的局域网设备网络宵禁与家长管控 LuCI 应用。

## 主要功能

- **定时断网**：按设备 MAC 地址设置星期与宵禁时段，支持跨午夜（如 `20:20` 至次日 `06:00`）。
- **无感生效**：直接原子更新 nftables 集合，无需重载整个防火墙，不影响其他设备上网。
- **防透明代理绕过**：挂载在 `prerouting` 的 `raw`（`-300`）优先级，先于 OpenClash / Nikki 等代理规则拦截。
- **不断 Wi-Fi**：阻断期间放行 DHCPv4 / DHCPv6 / ICMPv6 NDP，设备保持正常局域网地址租约。
- **临时放行与重启自愈**：支持一键临时放行（到期自动恢复），重启路由器或重载防火墙后自动恢复状态。

## 安装方法

安装完成后，在 LuCI 后台进入 **服务 → 设备网络宵禁** 即可配置。

### 方式一：添加软件源安装（推荐）

#### OpenWrt 25.x（`apk`）

```sh
# 1. 导入签名公钥
mkdir -p /etc/apk/keys
wget -qO /etc/apk/keys/fishyo-device-curfew.pem https://fishyo.github.io/luci-app-device-curfew/apk/fishyo-device-curfew.pem

# 2. 添加软件源
echo "https://fishyo.github.io/luci-app-device-curfew/apk/packages.adb" > /etc/apk/repositories.d/device-curfew.list

# 3. 更新并安装
apk update
apk add luci-app-device-curfew
```

> 如需备用直链，将上述地址中的 `https://fishyo.github.io/luci-app-device-curfew` 替换为 `https://raw.githubusercontent.com/fishyo/luci-app-device-curfew/gh-pages` 即可。

#### OpenWrt 22.03 ~ 24.10（`opkg`）

```sh
echo "src/gz fishyo_device_curfew https://fishyo.github.io/luci-app-device-curfew/opkg" >> /etc/opkg/customfeeds.conf
opkg update
opkg install luci-app-device-curfew
```

### 方式二：离线包安装

前往 [Releases](https://github.com/fishyo/luci-app-device-curfew/releases) 下载对应安装包：

- **OpenWrt 25.x（`.apk`）**：
  ```sh
  apk add --allow-untrusted luci-app-device-curfew-*.apk
  ```
- **OpenWrt 22.03 ~ 24.10（`.ipk`）**：
  ```sh
  opkg install luci-app-device-curfew_*_all.ipk
  ```
- **通用便携包（`.tar.gz`）**：
  ```sh
  tar -zxf luci-app-device-curfew_*_portable.tar.gz -C /
  chmod +x /usr/bin/device_curfew_ctl /etc/init.d/device_curfew /usr/share/device_curfew/firewall.include
  sh /etc/uci-defaults/luci-app-device-curfew
  ```

## 常用命令

```sh
device_curfew_ctl status                              # 查看当前状态 (JSON)
device_curfew_ctl sync                                # 按规则立即同步阻断状态
device_curfew_ctl temp_pass 00:11:22:33:44:55 30      # 临时放行 30 分钟
device_curfew_ctl clear_temp_pass 00:11:22:33:44:55   # 取消临时放行
device_curfew_ctl block 00:11:22:33:44:55             # 手动阻断
device_curfew_ctl unblock 00:11:22:33:44:55           # 手动解除阻断
```

## 从源码编译

```sh
git clone https://github.com/fishyo/luci-app-device-curfew.git package/luci-app-device-curfew
make menuconfig   # LuCI -> Applications -> luci-app-device-curfew
make package/luci-app-device-curfew/compile V=s
```

## 许可证

[Apache License 2.0](LICENSE)
