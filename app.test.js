const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_ENV = process.env.APP_ENV || "development";

// Endpoint principal
app.get("/", (req, res) => {
  res.json({
    message: "Hola desde mi-app-web!",
    env: APP_ENV,
    hostname: require("os").hostname(),
  });
});

// Health check: usado por Kubernetes (readiness / liveness probes)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Exportamos la app para poder testearla con supertest
module.exports = app;

// Solo levantamos el servidor si este archivo se ejecuta directamente
// (así los tests pueden importar `app` sin abrir un puerto real).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT} (env: ${APP_ENV})`);
  });
}
