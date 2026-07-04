# Compu_Web — CI/CD con GitHub Actions + Kubernetes

1. **GitHub Actions** — pipeline de CI/CD que testea, construye una imagen Docker y despliega.
2. **Kubernetes** — la app se despliega en un clúster mediante manifiestos declarativos (`Deployment`, `Service`, `ConfigMap`).

La aplicación en sí es simple: un servidor **Node.js + Express** con dos endpoints.

---

## Estructura del proyecto

```
Compu_Web/
├── src/index.js              # Servidor Express
├── test/app.test.js          # Tests con Jest + supertest
├── package.json
├── Dockerfile                # Empaqueta la app en una imagen
├── .dockerignore
├── .gitignore
├── k8s/
│   ├── deployment.yaml       # 2 réplicas + probes + recursos
│   ├── service.yaml          # Expone la app (NodePort)
│   ├── configmap.yaml        # Variable de entorno APP_ENV
│   ├── hpa.yaml              # Autoescalado horizontal por CPU
│   └── ingress.yaml          # Expone la app por host (nginx)
├── .github/workflows/
│   └── ci-cd.yml             # Pipeline de 3 etapas
└── README.md
```

---

## La aplicación

Dos endpoints:

- `GET /` → devuelve un JSON con un mensaje, el entorno y el hostname del pod.
- `GET /health` → devuelve `{ "status": "ok" }`. Kubernetes lo usa para los *liveness* y *readiness probes*.

### Correr localmente

```bash
npm install
npm start          # http://localhost:3000
npm test           # corre los tests
```

---

## Tecnología 1 — Kubernetes

Los manifiestos en `k8s/` describen el estado deseado del clúster de forma declarativa:

- **`deployment.yaml`**: pide **2 réplicas** de la app. Define `resources` (requests/limits de CPU y memoria) porque en producción siempre deben acotarse. Incluye *liveness* y *readiness probes* apuntando a `/health`, para que Kubernetes reinicie pods caídos y no envíe tráfico a pods que aún no están listos.
- **`service.yaml`**: un `Service` de tipo **NodePort** que agrupa los pods bajo una única IP estable y los expone en el puerto `30080` del nodo. Se eligió NodePort (en lugar de LoadBalancer) porque funciona sin un proveedor cloud, ideal para `minikube`/`kind`.
- **`configmap.yaml`**: inyecta la variable `APP_ENV` en los pods, separando configuración del código.
- **`hpa.yaml`**: un `HorizontalPodAutoscaler` que ajusta automáticamente el número de réplicas del Deployment `mi-app` según el uso de CPU. Se definió `minReplicas: 2` para no bajar de la base de alta disponibilidad del Deployment, `maxReplicas: 6` como tope razonable para un entorno de pruebas/académico, y `averageUtilization: 70` como umbral de CPU: es un valor típico que deja margen antes de saturar los pods sin escalar demasiado agresivo ante picos cortos. El HPA necesita **metrics-server** instalado en el clúster para poder leer el uso de CPU (ver más abajo).
- **`ingress.yaml`**: un `Ingress` que expone la app por el host `compu-web.local` en vez de por un puerto del nodo, tal como haría un proxy reverso HTTP en un entorno real. Enruta el path `/` al `Service` `mi-app-svc` en el puerto `80`. Requiere un **Ingress Controller** (`ingress-nginx`) corriendo en el clúster, que es quien realmente escucha el tráfico HTTP/HTTPS y aplica las reglas del recurso `Ingress`.

### Probarlo localmente con minikube

```bash
minikube start
minikube addons enable metrics-server   # requerido por hpa.yaml
minikube addons enable ingress          # requerido por ingress.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/ingress.yaml
kubectl rollout status deployment/mi-app
minikube service mi-app-svc      # abre la app en el navegador
```

> Para pruebas locales, edita la línea `image:` del `deployment.yaml`. En el pipeline esa imagen se reemplaza automáticamente (ver más abajo).

---

## Tecnología 2 — GitHub Actions

El pipeline (`.github/workflows/ci-cd.yml`) se dispara en cada `push` a `main` y en cada Pull Request. Tiene **tres jobs encadenados** con `needs:`, de modo que cada etapa solo corre si la anterior tuvo éxito:

1. **`test`** — Hace checkout, instala Node 20, ejecuta `npm ci` y corre los tests con Jest. Corre siempre (también en PRs) para validar cambios antes de mezclarlos.
2. **`docker`** — Solo en `push` a `main`. Construye la imagen con el `Dockerfile` y la publica en **GitHub Container Registry (`ghcr.io`)**, etiquetada con el SHA del commit y como `latest`. Como `github.repository` viene con mayúsculas (`TheBenwamin/Compu_Web`) y GHCR exige minúsculas, un step calcula el nombre de la imagen en minúsculas con `tr` antes de construir/publicar.
3. **`deploy`** — Solo en `push` a `main`. Levanta un clúster de Kubernetes real y despliega los manifiestos (detalle abajo). Como `kind` no trae **metrics-server** ni **ingress-nginx** por defecto, el job los instala antes de aplicar los manifiestos: primero `metrics-server` (parcheado con `--kubelet-insecure-tls`, necesario porque los certificados kubelet de `kind` no son válidos para el uso normal de ese componente) y espera su rollout, y luego `ingress-nginx` en su variante para `kind`, esperando a que el pod del controller quede `ready`. Recién ahí aplica `configmap.yaml`, `deployment.yaml`, `service.yaml`, `hpa.yaml` e `ingress.yaml`, y al final muestra `kubectl get hpa` y `kubectl get ingress` para dejar constancia en los logs de que ambos recursos quedaron activos.

### Autenticación sin secrets externos

El job `docker` se autentica contra GHCR usando `secrets.GITHUB_TOKEN`, un token que **GitHub genera automáticamente** en cada ejecución. No hace falta crear cuentas ni configurar credenciales de Docker Hub o de un cloud provider.

---

## ¿Por qué kind y no un clúster cloud real (EKS/GKE)?

Un pipeline de CI/CD "de libro" termina desplegando en un clúster gestionado en la nube (EKS en AWS, GKE en Google, AKS en Azure). El problema para un repositorio académico es que esa última etapa **no es reproducible por quien clona el repo**: requiere una cuenta cloud con facturación activa, un clúster ya creado, y secrets con credenciales de larga duración configurados en el repositorio. Si esos secrets no existen, el job de deploy simplemente falla, y el pipeline queda "roto" para cualquiera que lo revise.

Por eso este proyecto usa **`helm/kind-action`** para crear un clúster **kind** (*Kubernetes IN Docker*) efímero **dentro del propio runner de GitHub**. Las ventajas:

- **El deploy es real, no simulado.** Se ejecuta `kubectl apply` contra un clúster de Kubernetes de verdad, se espera el `rollout status` y se verifica que los pods queden `Running`. Demuestra que los manifiestos funcionan, no solo que existen.
- **Cero configuración externa.** No necesita cuenta cloud, ni tarjeta de crédito, ni secrets manuales. Cualquiera que haga *fork* del repo y un `push` obtiene el pipeline funcionando de inmediato.
- **Reproducible y gratuito.** kind corre sobre los minutos gratuitos de GitHub Actions y desaparece al terminar el job, sin dejar recursos que cuesten dinero.
- **Fiel al flujo real.** Se mantiene la misma secuencia test → build → push → deploy de un pipeline productivo; solo cambia el *destino* del deploy por uno efímero y reproducible.

El único paso "artificial" es sustituir el `image:` del deployment por la imagen recién publicada, que el workflow hace con un `sed` antes de aplicar los manifiestos.

> **¿Y si quisiera desplegar en un clúster cloud real?** Bastaría con reemplazar el job `deploy`: en lugar de `helm/kind-action`, se usaría la acción de autenticación del proveedor (p. ej. `aws-actions/configure-aws-credentials` con OIDC), un `aws eks update-kubeconfig`, y el mismo `kubectl apply`. La lógica de test y build no cambia.

---

## Resumen del flujo completo

```
git push a main
      │
      ▼
 ┌─────────┐   needs   ┌──────────┐   needs   ┌──────────┐
 │  test   │ ────────▶ │  docker  │ ────────▶ │  deploy  │
 │ (Jest)  │           │ build +  │           │  kind +  │
 │         │           │ push GHCR│           │ kubectl  │
 └─────────┘           └──────────┘           └──────────┘
```

No hay que configurar ningún secret manualmente: `GITHUB_TOKEN` es automático.
