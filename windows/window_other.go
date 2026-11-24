//go:build !windows

package main

import "fmt"

func openWindow(url string) { fmt.Println("Kasse läuft unter", url) }
func showError(msg string)  { fmt.Println(msg) }
