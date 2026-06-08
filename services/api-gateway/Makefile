.PHONY: build run test clean

BINARY_NAME=api-gateway
BUILD_DIR=./dist

build:
	go build -o $(BUILD_DIR)/$(BINARY_NAME) .

run:
	go run .

test:
	go test -v ./...

clean:
	rm -rf $(BUILD_DIR)
