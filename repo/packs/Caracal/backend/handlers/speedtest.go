package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/showwin/speedtest-go/speedtest"
)

type SpeedTestResult struct {
	Download float64 `json:"download"`
	Upload   float64 `json:"upload"`
	Ping     float64 `json:"ping"`
	Jitter   float64 `json:"jitter"`
	Server   string  `json:"server"`
	Location string  `json:"location"`
	ISP      string  `json:"isp"`
	IP       string  `json:"ip"`
	Error    string  `json:"error,omitempty"`
}

func RunSpeedTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	log.Println("Starting speed test...")

	user, err := speedtest.FetchUserInfo()
	if err != nil {
		log.Printf("Error fetching user info: %v", err)
		http.Error(w, `{"error": "Failed to fetch user info"}`, http.StatusInternalServerError)
		return
	}

	serverList, err := speedtest.FetchServers()
	if err != nil {
		log.Printf("Error fetching server list: %v", err)
		http.Error(w, `{"error": "Failed to fetch server list"}`, http.StatusInternalServerError)
		return
	}

	targets, err := serverList.FindServer([]int{})
	if err != nil {
		log.Printf("Error finding closest server: %v", err)
		http.Error(w, `{"error": "Failed to find closest server"}`, http.StatusInternalServerError)
		return
	}

	var downloadSpeed, uploadSpeed float64
	var pingTime, jitterTime time.Duration
	var serverName, serverLocation string

	if len(targets) > 0 {
		server := targets[0]
		serverName = server.Name
		serverLocation = server.Country + ", " + server.Sponsor

		err = server.PingTest(func(latency time.Duration) {})
		if err != nil {
			log.Printf("Error during ping test: %v", err)
		}
		pingTime = server.Latency
		jitterTime = server.Jitter

		err = server.DownloadTest()
		if err != nil {
			log.Printf("Error during download test: %v", err)
		}
		downloadSpeed = server.DLSpeed.Mbps()

		err = server.UploadTest()
		if err != nil {
			log.Printf("Error during upload test: %v", err)
		}
		uploadSpeed = server.ULSpeed.Mbps()

	} else {
		log.Println("No speedtest servers found.")
		http.Error(w, `{"error": "No speedtest servers found"}`, http.StatusInternalServerError)
		return
	}

	result := SpeedTestResult{
		Download: downloadSpeed,
		Upload:   uploadSpeed,
		Ping:     float64(pingTime.Milliseconds()),
		Jitter:   float64(jitterTime.Milliseconds()),
		Server:   serverName,
		Location: serverLocation,
		ISP:      user.Isp,
		IP:       user.IP,
	}

	log.Printf("Speed test completed: %+v\n", result)

	json.NewEncoder(w).Encode(result)
}
