"""Starter workspace.dsl templates."""

from __future__ import annotations

SCAFFOLDS: dict[str, str] = {
    "minimal": '''workspace "Example" "Minimal Structurizr workspace" {

    !identifiers hierarchical

    model {
        user = person "User" "A user of the system"
        system = softwareSystem "Software System" "The system under design" {
            web = container "Web Application" "Delivers UI" "React"
            api = container "API" "Business logic" "Node.js"
            db = container "Database" "Stores data" "PostgreSQL"

            web -> api "Makes API calls" "JSON/HTTPS"
            api -> db "Reads from and writes to" "SQL/TCP"
        }
        user -> web "Uses" "HTTPS"
    }

    views {
        systemContext system "SystemContext" {
            include *
            autoLayout lr
        }
        container system "Containers" {
            include *
            autoLayout tb
        }
        styles {
            element "Person" { shape Person }
            element "Software System" { background #1168bd color #ffffff }
            element "Container" { background #438dd5 color #ffffff }
        }
    }
}
''',
    "monolith": '''workspace "Monolith" "Single deployable application" {

    !identifiers hierarchical

    model {
        user = person "User"
        system = softwareSystem "Application" {
            app = container "Monolith" "Single deployable unit" ".NET" {
                ui = component "UI Layer" "Controllers/pages"
                domain = component "Domain Layer" "Business rules"
                data = component "Data Layer" "Persistence"
                ui -> domain "Uses"
                domain -> data "Uses"
            }
            db = container "Database" "Relational store" "PostgreSQL"
            app -> db "Reads from and writes to"
        }
        user -> app "Uses"
    }

    views {
        systemContext system "Context" { include * autoLayout lr }
        container system "Containers" { include * autoLayout tb }
        component app "Components" { include * autoLayout tb }
    }
}
''',
    "microservices": '''workspace "Microservices" "Distributed system" {

    !identifiers hierarchical

    model {
        user = person "User"
        platform = softwareSystem "Platform" {
            gateway = container "API Gateway" "Edge routing" "Kong"
            orders = container "Orders Service" "Order lifecycle" "Java"
            inventory = container "Inventory Service" "Stock levels" "Go"
            broker = container "Message Broker" "Async events" "RabbitMQ"
            gateway -> orders "Routes requests" "HTTPS"
            gateway -> inventory "Routes requests" "HTTPS"
            orders -> broker "Publishes events" "AMQP"
            inventory -> broker "Consumes events" "AMQP"
        }
        user -> gateway "Uses" "HTTPS"
    }

    views {
        systemContext platform "Context" { include * autoLayout lr }
        container platform "Containers" { include * autoLayout tb }
    }
}
''',
    "kubernetes": '''workspace "Kubernetes Deployment" "K8s deployment model" {

    !identifiers hierarchical

    model {
        user = person "User"
        system = softwareSystem "Application" {
            api = container "API" "REST API" "Container image"
            worker = container "Worker" "Background jobs" "Container image"
        }
        user -> api "Uses" "HTTPS"

        production = deploymentEnvironment "Production" {
            cluster = deploymentNode "Kubernetes Cluster" "RKE2" "Kubernetes" {
                namespace = deploymentNode "Application Namespace" {
                    apiInstance = containerInstance api
                    workerInstance = containerInstance worker
                }
                ingress = infrastructureNode "Ingress" "nginx-ingress" "nginx"
                ingress -> apiInstance "Routes to" "HTTPS"
            }
        }
    }

    views {
        systemContext system "Context" { include * autoLayout lr }
        container system "Containers" { include * autoLayout tb }
        deployment system production "Production" { include * autoLayout tb }
    }
}
''',
}


def get_scaffold(name: str) -> str | None:
    return SCAFFOLDS.get(name)