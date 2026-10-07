self: { config, lib, pkgs, ... }:
let
  cfg = config.programs.inlark;
in {
  options.programs.inlark.enable = lib.mkEnableOption "inlark email client";

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ self.packages.${pkgs.stdenv.hostPlatform.system}.default ];
  };
}
