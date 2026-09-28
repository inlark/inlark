{
  description = "Inlark — a considered home for your email";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      eachSystem = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in {
      packages = eachSystem (pkgs: rec {
        inlark = pkgs.callPackage ./nix/package.nix { };
        default = inlark;
      });
      nixosModules.default = import ./nix/module.nix self;
      devShells = eachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_24 pnpm_12 electron_44 python3 ];
          ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
          ELECTRON_EXEC_PATH = "${pkgs.electron_44}/bin/electron";
          shellHook = ''
            export ELECTRON_OZONE_PLATFORM_HINT=auto
          '';
        };
      });
      checks = eachSystem (pkgs: { build = self.packages.${pkgs.stdenv.hostPlatform.system}.default; });
    };
}
