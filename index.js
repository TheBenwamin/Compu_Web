apiVersion: v1
kind: Service
metadata:
  name: mi-app-svc
spec:
  # NodePort: expone la app en un puerto del nodo, práctico para
  # minikube/kind y para probar desde fuera del clúster.
  type: NodePort
  selector:
    app: mi-app
  ports:
    - port: 80          # puerto del Service dentro del clúster
      targetPort: 3000  # puerto del contenedor (Express)
      nodePort: 30080   # puerto expuesto en el nodo (rango 30000-32767)
