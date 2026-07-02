package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

type TasteProfile struct {
	UserIDHash             string   `json:"userIdHash"`
	SpiceTolerance        int      `json:"spiceTolerance"`
	NoveltyPreference     int      `json:"noveltyPreference"`
	LikedCuisines         []string `json:"likedCuisines"`
	DislikedIngredients   []string `json:"dislikedIngredients"`
	DietaryRules          []string `json:"dietaryRules"`
	WeeklyCuisineHistory  []string `json:"weeklyCuisineHistory"`
	BudgetComfort         int      `json:"budgetComfort"`
	UpdatedAt             string   `json:"updatedAt"`
}

type TeamProfile struct {
	TeamID           string   `json:"teamId"`
	Name             string   `json:"name"`
	Headcount        int      `json:"headcount"`
	BudgetPerPerson  int      `json:"budgetPerPerson"`
	DietaryRules     []string `json:"dietaryRules"`
	CuisineAvoidList []string `json:"cuisineAvoidList"`
	SpiceTolerance   int      `json:"spiceTolerance"`
	UpdatedAt        string   `json:"updatedAt"`
}

type Store struct {
	mu       sync.RWMutex
	users    map[string]TasteProfile
	teams    map[string]TeamProfile
	feedback []map[string]any
	audit    []map[string]any
}

func main() {
	store := NewStore()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", store.health)
	mux.HandleFunc("/profiles/", store.profile)
	mux.HandleFunc("/teams/", store.team)
	mux.HandleFunc("/feedback", store.feedbackHandler)
	mux.HandleFunc("/privacy/export/", store.exportMemory)
	mux.HandleFunc("/privacy/delete/", store.deleteMemory)
	mux.HandleFunc("/audit", store.auditHandler)

	port := os.Getenv("PROFILE_PORT")
	if port == "" {
		port = "8790"
	}
	log.Printf("Moodish profile service listening on http://127.0.0.1:%s", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, withCors(mux)))
}

func NewStore() *Store {
	now := time.Now().UTC().Format(time.RFC3339)
	return &Store{
		users: map[string]TasteProfile{
			"sha256:demo-user": {
				UserIDHash:            "sha256:demo-user",
				SpiceTolerance:       3,
				NoveltyPreference:    4,
				LikedCuisines:        []string{"South Indian", "Thai", "Bengali"},
				DislikedIngredients:  []string{"mushroom"},
				DietaryRules:         []string{"high-protein"},
				WeeklyCuisineHistory: []string{"North Indian", "Biryani"},
				BudgetComfort:        350,
				UpdatedAt:            now,
			},
		},
		teams: map[string]TeamProfile{
			"team-demo": {
				TeamID:           "team-demo",
				Name:             "Demo Product Pod",
				Headcount:        6,
				BudgetPerPerson:  250,
				DietaryRules:     []string{"veg", "high-protein"},
				CuisineAvoidList: []string{"North Indian"},
				SpiceTolerance:   2,
				UpdatedAt:        now,
			},
		},
	}
}

func (s *Store) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "moodish-profile-go"})
}

func (s *Store) profile(w http.ResponseWriter, r *http.Request) {
	id := trimPrefix(r.URL.Path, "/profiles/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing user id"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		profile, ok := s.users[id]
		s.mu.RUnlock()
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "profile not found"})
			return
		}
		writeJSON(w, http.StatusOK, profile)
	case http.MethodPost:
		var profile TasteProfile
		if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		profile.UserIDHash = id
		profile.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		s.mu.Lock()
		s.users[id] = profile
		s.logLocked("profile_updated", map[string]any{"userIdHash": id})
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, profile)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Store) team(w http.ResponseWriter, r *http.Request) {
	id := trimPrefix(r.URL.Path, "/teams/")
	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		team, ok := s.teams[id]
		s.mu.RUnlock()
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "team not found"})
			return
		}
		writeJSON(w, http.StatusOK, team)
	case http.MethodPost:
		var team TeamProfile
		if err := json.NewDecoder(r.Body).Decode(&team); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		team.TeamID = id
		team.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		s.mu.Lock()
		s.teams[id] = team
		s.logLocked("team_updated", map[string]any{"teamId": id})
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, team)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Store) feedbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var event map[string]any
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	event["createdAt"] = time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	s.feedback = append(s.feedback, event)
	s.logLocked("feedback_recorded", event)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, event)
}

func (s *Store) exportMemory(w http.ResponseWriter, r *http.Request) {
	id := trimPrefix(r.URL.Path, "/privacy/export/")
	s.mu.RLock()
	profile, ok := s.users[id]
	feedback := append([]map[string]any(nil), s.feedback...)
	s.mu.RUnlock()
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "profile not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "feedback": feedback, "exportedAt": time.Now().UTC().Format(time.RFC3339)})
}

func (s *Store) deleteMemory(w http.ResponseWriter, r *http.Request) {
	id := trimPrefix(r.URL.Path, "/privacy/delete/")
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	s.mu.Lock()
	delete(s.users, id)
	s.logLocked("taste_memory_deleted", map[string]any{"userIdHash": id})
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "userIdHash": id})
}

func (s *Store) auditHandler(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	logs := append([]map[string]any(nil), s.audit...)
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

func (s *Store) logLocked(event string, details map[string]any) {
	s.audit = append(s.audit, map[string]any{"ts": time.Now().UTC().Format(time.RFC3339), "event": event, "details": details})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func withCors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("access-control-allow-origin", "*")
		w.Header().Set("access-control-allow-methods", "GET,POST,OPTIONS")
		w.Header().Set("access-control-allow-headers", "content-type,authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func trimPrefix(value, prefix string) string {
	if len(value) < len(prefix) || value[:len(prefix)] != prefix {
		return ""
	}
	return value[len(prefix):]
}
