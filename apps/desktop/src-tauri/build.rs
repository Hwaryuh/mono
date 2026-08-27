fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    // release exe는 이 zip을 통째로 임베드한다(src/api_sidecar.rs). scripts/build-api-sidecar.ps1이
    // 실제 내용(node.exe + 번들된 API)을 채우기 전이라도 컴파일은 되도록 빈 파일을 만들어 둔다.
    println!("cargo:rerun-if-changed=sidecar.zip");
    if !std::path::Path::new("sidecar.zip").exists() {
        std::fs::write("sidecar.zip", []).expect("sidecar.zip 플레이스홀더 생성 실패");
    }
    tauri_build::build()
}
