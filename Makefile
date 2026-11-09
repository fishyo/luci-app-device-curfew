#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Device Curfew & Parental Access Control
LUCI_DEPENDS:=+luci-base +nftables
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-device-curfew
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=fishyo <liweisp1990@gmail.com>

define Package/$(PKG_NAME)/conffiles
/etc/config/device_curfew
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
