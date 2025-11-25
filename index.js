const fs = require("fs");
const http = require("http");
const https = require("https");

// --- Configuration ---
const credentials = require("./auth/credentials.json");
const port = process.env.PORT || 3000;


const user_agent = process.env.USER_AGENT || credentials["User-Agent"];
const authorization_key = process.env.AUTHORIZATION_KEY || credentials["Authorization-Key"];

const dictionary_api_base = "https://api.dictionaryapi.dev/api/v2/entries/en_US";
const usajobs_api_base = new URL("https://data.usajobs.gov/api/search");


// --- Headers ---
const usajobs_request_headers = {
    "Host":"data.usajobs.gov",
    "User-Agent":user_agent,
    "Authorization-Key":authorization_key,
};
const response_headers = {
    "Content-Type": "text/html; charset=utf-8",
};

// --- Server Setup ---
const server = http.createServer();
server.on("request", handle_request);
server.on("listening", handle_listen);
server.listen(port);

// --- Handlers ---
function handle_listen(){
    console.log(`Now Listening on Port ${port}`);
}
function handle_request(req, res){
    console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
        const form = fs.createReadStream("html/index.html");
		res.writeHead(200, response_headers)
		form.pipe(res);
    }
    else if (req.url.startsWith("/search")){
		res.writeHead(200, response_headers);
        const user_input = new URL(req.url, `http://${req.headers.host}`).searchParams;
		
        const word = user_input.get("word") || "";
		const unsanitized_delay_dictionary = parseInt(user_input.get("delay_dictionary")) || 0;
		const delay_dictionary = Math.min(10000, Math.max(0, unsanitized_delay_dictionary));
        const keyword = user_input.get("keyword") || "";
        const location_name = user_input.get("location_name") || "";
		const unsanitized_delay_usajobs = parseInt(user_input.get("delay_usajobs")) || 0;
		const delay_usajobs = Math.min(10000, Math.max(0, unsanitized_delay_usajobs));
		
		close_after_both = latch(2, () => res.end());
		
		// async (order not guaranteed)
		get_dictionary_data(word, delay_dictionary, res, close_after_both);
        get_job_data(keyword, location_name, delay_usajobs, res, close_after_both);
    }
    else{
        res.writeHead(404, response_headers);
        res.end(`<h1>404 Not Found</h1>`);
    }
}

// --- Utility Function ---
function process_http_stream(stream, callback, ...args) {
    const {statusCode: status_code} = stream;
    let body = "";
    stream.on("data", function (chunk) {
        body += chunk;
    });
    stream.on("end", () => callback(body, status_code, ...args));
}

function latch(count, final_callback) {
    return function () {
        if (--count === 0) {
            final_callback();
        }
    };
}

// --- Access Web Services ---
function get_dictionary_data(word, delay_dictionary, res, close_after_both) {
    const dictionary_url = `${dictionary_api_base}/${encodeURIComponent(word)}`;
    const dictionary_api = https.request(dictionary_url);
	const request_data = {word, delay_dictionary};
    dictionary_api.once("response", (dictionary_res) => process_http_stream(dictionary_res, parse_dictionary, request_data, res, close_after_both));
    dictionary_api.end();    // Sends the Request
}
function get_job_data(keyword, location_name, delay_usajobs, res, close_after_both){
    const usajobs_url = new URL(usajobs_api_base);
    if (keyword) {
        usajobs_url.searchParams.set("keyword", keyword);
    }
    if (location_name) {
        usajobs_url.searchParams.set("location_name", location_name);
    }
    const jobs_req = https.request(usajobs_url, {method:"GET", headers:usajobs_request_headers});
    const request_data = {keyword, location_name, delay_usajobs};
    jobs_req.once("response", (jobs_res) => process_http_stream(jobs_res, parse_usajobs, request_data, res, close_after_both));
    jobs_req.end();    // Sends the Request
}

// --- Parse Responses ---
function parse_dictionary(word_json, status_code, request_data, res, close_after_both){
	const {word, delay_dictionary} = request_data;
    const word_obj = JSON.parse(word_json);
    const definition = word_obj?.[0]?.meanings?.[0]?.definitions?.[0]?.definition || "No definition available";
    const results_html = `<div style="width:50%; float:right;"><h1>Results: ${word}</h1><p>${definition}</p></div>`;
	setTimeout(() => res.write(results_html, close_after_both), delay_dictionary);
}
function parse_usajobs(job_json, status_code, request_data, res, close_after_both) {
	const {keyword, location_name, delay_usajobs} = request_data;
    const jobs_object = JSON.parse(job_json);
    const jobs = jobs_object?.SearchResult?.SearchResultItems || [];
    const results = jobs.map(format_job).join("");
    const results_html = `<div style="width:50%; float:left;"><h2>Search Results: ${keyword || "All Jobs"} in ${location_name || "Everywhere"}</h2>${results}</div>`;
	setTimeout(() => res.write(results_html, close_after_both), delay_usajobs);
}

// --- Format Job ---
function format_job (job) {
    const job_descriptor = job?.MatchedObjectDescriptor;
    const title = job_descriptor?.PositionTitle;
    const url = job_descriptor?.PositionURI;
    const description = job_descriptor?.QualificationSummary;
    return `
        <li>
            <a href="${url}">${title}</a>
            <p>${description}</p>
        </li>
    `;
}
