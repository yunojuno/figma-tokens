# YunoJuno's Dev Environment
# ==========================
#
# We base our developer environment on Nix, the functional package
# manager and its sister package nix-shell which allows for per-
# directory "virtual environments".
#
# We use `nix-shell` alongside `direnv`, so that the environment
# gets loaded as soon as you enter the directory with your shell.
#
# We choose to use the rolling Nix Channel named `nixpgks-unstable`,
# as we stay fairly up-to-date with new versions of NodeJS.
# Read more about Channels here: https://nixos.wiki/wiki/Nix_channels
#
#
# Re-pinning
# ----------
#
# Re-pinning is the act of updating which version of a specific
# channel (tree of packages) we are relying on at a given moment
# in time. If you require a NodeJS version to bump,
# re-pinning is what you want.

{ pkgs ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/12bdeb01ff9e2d3917e6a44037ed7df6e6c3df9d.tar.gz") {}
, lib ? pkgs.lib
, stdenv ? pkgs.stdenv
, frameworks ? pkgs.darwin.apple_sdk.frameworks
}:

let
    basePackages = with pkgs; [
        # Dev-env tooling
        go-task

        # Node deps
        nodejs_20

        # for many deps
        pkg-config
        fontconfig
    ];

    inputs = basePackages
        ++ lib.optional stdenv.isDarwin [
            pkgs.xcodebuild
            frameworks.CoreText # for node-canvas
        ] ++ lib.optional stdenv.isLinux [
            pkgs.stdenv.cc.cc.lib
            pkgs.playwright.browsers
            pkgs.libuuid.lib
        ];

    shellExports = "" + lib.optionalString stdenv.isLinux ''
        export LD_LIBRARY_PATH=${stdenv.cc.cc.lib}/lib/:${pkgs.libuuid.lib}/lib/
    '';

in pkgs.mkShell {

     nativeBuildInputs = inputs;

     FONTCONFIG_FILE = "${pkgs.fontconfig.out}/etc/fonts/fonts.conf";

     shellHook = shellExports + ''
        set -e

        # Setup the language & locale vars
        export LANG="en_GB.UTF-8"
        export LANGUAGE="en_GB.UTF-8"
        export LC_ALL="en_GB.UTF-8"

        # Allow the use of wheels.
        export SOURCE_DATE_EPOCH=$(date +%s)

        echo ""
        echo ""
        echo "__     __                     _                   "
        echo "\ \   / /                    | |                  "
        echo " \ \_/ /   _ _ __   ___      | |_   _ _ __   ___  "
        echo "  \   / | | | '_ \ / _ \ _   | | | | | '_ \ / _ \ "
        echo "   | || |_| | | | | (_) | |__| | |_| | | | | (_) |"
        echo "   |_| \__,_|_| |_|\___/ \____/ \__,_|_| |_|\___/ "
        echo ""
        echo "   =============================================  "
        echo "   ========== Development Environment ==========  "
        echo "   =============== [figma-tokens] ==============  "
        echo "   =============== [Node `node --version`] ==============  "
        echo ""
    '';
}
