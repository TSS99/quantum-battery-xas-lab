//! XAS Lab as a desktop app: one window showing the bundled site. Links to other sites (papers, GitHub, the data
//! sources) open in the system browser rather than inside the app.
use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn external(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https") && !matches!(url.host_str(), Some("tauri.localhost") | Some("localhost"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("XAS Lab")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .on_navigation(move |url| {
                    if external(url) {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                        return false;
                    }
                    true
                })
                .on_page_load(|window, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        let _ = window.set_title("XAS Lab");
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running XAS Lab");
}
