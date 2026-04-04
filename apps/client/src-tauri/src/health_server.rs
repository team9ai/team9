use axum::{routing::get, Json, Router};
use serde_json::json;
use std::net::SocketAddr;

async fn health_handler() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "app": "team9-desktop",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub async fn start_health_server() {
    // No CORS layer needed — the service worker's fetch() is a no-CORS
    // opaque request so Access-Control headers are irrelevant. Omitting
    // CORS prevents arbitrary websites from probing whether the desktop
    // app is installed (fingerprinting / privacy concern).
    let app = Router::new()
        .route("/health", get(health_handler));

    let addr = SocketAddr::from(([127, 0, 0, 1], 19876));

    // If port is already in use (another instance), silently fail
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            let _ = axum::serve(listener, app).await;
        }
        Err(e) => {
            eprintln!(
                "Health server failed to bind to {}: {} (another instance may be running)",
                addr, e
            );
        }
    }
}
