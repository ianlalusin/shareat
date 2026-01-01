{ pkgs ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/3f6633636251b32b1239f50f4c40332569d750c1.tar.gz") {} }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_20
    ripgrep
  ];

  shellHook = ''
    # Add anything you want to run when the shell starts.
    # For example, you can set environment variables.
    # export MY_VAR="my_value"
    echo "Nix shell loaded."
  '';
}
