use axum::{routing::get, Json, Router};
use serde_json::json;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

async fn health_handler() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "app": "team9-desktop",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub async fn start_health_server() {
    let app = Router::new()
        .route("/health", get(health_handler))
        .layer(CorsLayer::permissive());

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
