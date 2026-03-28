{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { localSystem = system; };
        pnpm_nodejs24 = pkgs.pnpm.override {
          nodejs = pkgs.nodejs_24;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm_nodejs24

            typescript-language-server
          ];
        };
      }
    );
}
