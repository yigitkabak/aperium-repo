package main

import (
	"log"
	"net/http"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
	"github.com/foolin/goview"
	"Caracal/backend/handlers"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://localhost:8080"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	})
	r.Use(corsHandler.Handler)

	viewsDir := filepath.Join("..", "frontend", "views")

	gv := goview.New(goview.Config{
		Root:      viewsDir,
		Extension: ".ejs",
	})

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		err := gv.Render(w, http.StatusOK, "index", nil)
		if err != nil {
			log.Printf("Error rendering template: %v", err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/speedtest", handlers.RunSpeedTest)
	})

	log.Println("Server listening on :1881")
	if err := http.ListenAndServe(":1881", r); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
