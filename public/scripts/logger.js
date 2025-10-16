const log = console.log
        const error = console.error
        const info = console.info

        console.log = (message) => {
            log(message)
            document.getElementById("logs").innerHTML += `<span>log: ${message}</span><br>`
        }

        console.error = (message) => {
            error(message)
            document.getElementById("logs").innerHTML += `<span style="color: red">error: ${message}</span><br>`
        }

        console.info = (message) => {
            info(message)
            document.getElementById("logs").innerHTML += `<span style="color: yellow">info: ${message}</span><br>`
        }

        console.warn = (message) => {
            info(message)
            document.getElementById("logs").innerHTML += `<span style="color: orange">warn: ${message}</span><br>`
        }

        // export console functions
        window.log = log
        window.error = error
        window.info = info                                                                          